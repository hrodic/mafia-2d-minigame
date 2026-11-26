# Dependency-free static file server for local development.
# Usage: powershell -ExecutionPolicy Bypass -File tools/serve.ps1 [-Port 8123]
# Serves the repository root over http://localhost:<port>/ (ES modules need http).

param(
  [int]$Port = 8123,
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;

public class TinyHttpServer
{
    static string root;
    static Dictionary<string, string> mime;

    public static void Start(int port, string rootDir)
    {
        root = Path.GetFullPath(rootDir);
        mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".js",   "text/javascript; charset=utf-8" },
            { ".css",  "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".png",  "image/png" },
            { ".svg",  "image/svg+xml" },
            { ".ico",  "image/x-icon" },
            { ".md",   "text/plain; charset=utf-8" }
        };

        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        Console.WriteLine("Serving " + root + " at http://localhost:" + port + "/");
        while (true)
        {
            var client = listener.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(delegate(object state) { Handle((TcpClient)state); }, client);
        }
    }

    static void Handle(TcpClient client)
    {
        try
        {
            using (client)
            {
                var stream = client.GetStream();
                stream.ReadTimeout = 5000;
                stream.WriteTimeout = 5000;
                var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                var requestLine = reader.ReadLine();
                if (requestLine == null) return;

                string line;
                while (!string.IsNullOrEmpty(line = reader.ReadLine())) { }

                var parts = requestLine.Split(' ');
                var target = parts.Length > 1 ? parts[1] : "/";
                var pathOnly = target.Split('?')[0];
                var rel = Uri.UnescapeDataString(pathOnly).TrimStart('/');
                if (rel.Length == 0) rel = "index.html";

                string full = "";
                try { full = Path.GetFullPath(Path.Combine(root, rel)); } catch { }
                try { if (full.Length > 0 && Directory.Exists(full)) full = Path.Combine(full, "index.html"); } catch { }

                string status;
                string type;
                byte[] body;

                if (full.Length > 0 &&
                    full.StartsWith(root, StringComparison.OrdinalIgnoreCase) &&
                    File.Exists(full))
                {
                    status = "200 OK";
                    var ext = Path.GetExtension(full);
                    type = mime.ContainsKey(ext) ? mime[ext] : "application/octet-stream";
                    body = File.ReadAllBytes(full);
                }
                else
                {
                    status = "404 Not Found";
                    type = "text/plain; charset=utf-8";
                    body = Encoding.UTF8.GetBytes("404 Not Found: " + rel);
                }

                var header = "HTTP/1.1 " + status + "\r\n" +
                             "Content-Type: " + type + "\r\n" +
                             "Content-Length: " + body.Length + "\r\n" +
                             "Cache-Control: no-store\r\n" +
                             "Connection: close\r\n\r\n";
                var headerBytes = Encoding.ASCII.GetBytes(header);
                stream.Write(headerBytes, 0, headerBytes.Length);
                stream.Write(body, 0, body.Length);
                stream.Flush();
            }
        }
        catch
        {
            // A dropped connection must never kill the listener.
        }
    }
}
"@ -Language CSharp

[TinyHttpServer]::Start($Port, $Root)
