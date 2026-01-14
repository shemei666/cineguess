
import http.server
import socketserver
import json
import csv
import os
import io
import sys

PORT = 8000
CSV_FILE = 'imdb_movies_1990_plus.csv'

class RedactionAdminHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/movies':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            movies = []
            try:
                if os.path.exists(CSV_FILE):
                    with open(CSV_FILE, 'r', encoding='utf-8') as f:
                        reader = csv.DictReader(f)
                        # Read all rows into a list
                        movies = list(reader)
                        
                self.wfile.write(json.dumps(movies).encode('utf-8'))
            except Exception as e:
                print(f"Error reading CSV: {e}")
                self.wfile.write(json.dumps([]).encode('utf-8'))
        else:
            # Serve static files
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/save':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                target_title = data.get('title')
                new_indices = data.get('hiddenIndices')
                
                if not target_title:
                    self.send_error(400, "Missing title")
                    return

                # Read all movies
                movies = []
                headers = []
                updated = False
                
                if os.path.exists(CSV_FILE):
                    with open(CSV_FILE, 'r', encoding='utf-8', newline='') as f:
                        reader = csv.DictReader(f)
                        headers = reader.fieldnames
                        movies = list(reader)
                else:
                    self.send_error(500, "CSV file not found")
                    return

                # Update the specific movie
                for movie in movies:
                    if movie['Title'] == target_title:
                        movie['HiddenIndices'] = new_indices
                        updated = True
                        break
                
                if updated:
                    # Write back to CSV
                    with open(CSV_FILE, 'w', encoding='utf-8', newline='') as f:
                        writer = csv.DictWriter(f, fieldnames=headers)
                        writer.writeheader()
                        writer.writerows(movies)
                        
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
                else:
                    self.send_error(404, "Movie not found")
                    
            except Exception as e:
                print(f"Error saving data: {e}")
                self.send_error(500, str(e))
        else:
            self.send_error(404)

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    try:
        with ReusableTCPServer(("", PORT), RedactionAdminHandler) as httpd:
            print(f"Serving admin tool at http://localhost:{PORT}/admin.html")
            print(f"Serving API at http://localhost:{PORT}/api/movies")
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()
    except OSError as e:
        print(f"Error: Could not start server on port {PORT}. {e}")
        print("Check if the port is already in use or try closes other python instances.")
        sys.exit(1)
    except KeyboardInterrupt:
        pass
