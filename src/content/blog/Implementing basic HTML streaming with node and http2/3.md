---
author: W
featured: false
draft: false
description: study for http tranfer encoding header for streaming and how to implement streaming in http2/3
pubDatetime: 2024-11-15T01:24:00Z
title: Implementing basic HTML streaming with node and http2 / http3
tags:
  - Programming
---

### What

I found the interesting video from twitter: https://x.com/asidorenko_/status/1857475654364655751 we could see the author shows a basic http streaming function with node.js and next.js(?). We could see the first change is add "transfer-encoding: chunked" in response header like below.

        res.writeHead(200, {
            'Content-Type': 'text/html',
            'Transfer-Encoding': 'chunked'
        });

And we could keep response write action like , till we use res.end() to finish the streaming process.

### Where is the question from?

I go to MDN, and coud related information about transfer-encoding, it has warning like "Warning: HTTP/2 disallows all uses of the Transfer-Encoding header other than the HTTP/2 specific: "trailers". ". What? because HTTP2 and HTTP3 "Data is transmitted as frames within streams. Each frame inherently acts like a chunk, and there's no need for the server to explicitly specify chunk boundaries using "chunked" encoding."

So how could http2/3 implement the streaming function in node.js? I go to chatgpt (my dear friend) to get the answer.

For http2, below is sample code, we could see the server listen to "stream" event and just response with write() and end(), more easy than http1.1.

          const http2 = require('http2');
          const fs = require('fs');

          // Create an HTTP/2 server
          const server = http2.createSecureServer({
              key: fs.readFileSync('server.key'),
              cert: fs.readFileSync('server.crt'),
          });

          server.on('stream', (stream, headers) => {
              // Respond to the request with streamed data
              stream.respond({
                  ':status': 200,
                  'content-type': 'text/html',
              });

              // Write the initial part of the response
              stream.write('<!DOCTYPE html><html><head><title>HTTP/2 Streaming</title></head><body>');
              stream.write('<h1>Welcome to HTTP/2 Streaming</h1>');

              // Simulate streaming chunks with delays
              setTimeout(() => {
                  stream.write('<p>First chunk of content streamed.</p>');
              }, 1000);

              setTimeout(() => {
                  stream.write('<p>Second chunk of content streamed.</p>');
              }, 2000);

              setTimeout(() => {
                  stream.write('<p>Final chunk of content streamed.</p>');
                  stream.end('</body></html>'); // End the stream
              }, 3000);
          });

          server.listen(3000, () => {
              console.log('HTTP/2 server running at https://localhost:3000/');
          });

For http3, chatgpt mentioned "For HTTP/3, use a library like Quiche or a reverse proxy like NGINX with HTTP/3 enabled, since native HTTP/3 support in Node.js is still evolving. The streaming concept remains the same as HTTP/2.", got it!

### Links

https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Transfer-Encoding

https://chatgpt.com/share/6737ec5a-0fb8-8009-a358-16b6e40d447d
