from docling.document_converter import DocumentConverter

source = "https://arxiv.org/pdf/2606.01152"
converter = DocumentConverter()
doc = converter.convert(source).document
print(doc.export_to_markdown())
