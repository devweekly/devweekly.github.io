import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
export interface StoredObject { key: string; uri: string; contentType: string; size: number; }
export interface ObjectStore { put(originalName: string, body: Buffer, contentType: string): Promise<StoredObject>; }
class LocalObjectStore implements ObjectStore {
  constructor(private readonly baseDir: string) {}
  async put(originalName: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "file";
    const key = new Date().toISOString().slice(0, 10) + "/" + randomUUID() + "-" + safeName;
    const destination = resolve(this.baseDir, key);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body, { mode: 0o600 });
    return { key, uri: "file://" + destination, contentType, size: body.length };
  }
}
class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  constructor(private readonly bucket: string, private readonly prefix: string, region: string) { this.client = new S3Client({ region }); }
  async put(originalName: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "file";
    const key = [this.prefix,new Date().toISOString().slice(0,10),randomUUID()+"-"+safeName].filter(Boolean).join("/");
    await this.client.send(new PutObjectCommand({ Bucket:this.bucket, Key:key, Body:body, ContentType:contentType }));
    return { key, uri:"s3://"+this.bucket+"/"+key, contentType, size:body.length };
  }
}
export function createObjectStore(): ObjectStore {
  if (process.env.STORAGE_DRIVER === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    return new S3ObjectStore(bucket,process.env.S3_PREFIX || "architecture-workbench",process.env.AWS_REGION || "ap-northeast-1");
  }
  return new LocalObjectStore(resolve(process.env.LOCAL_OBJECT_DIR || "./data/objects"));
}
