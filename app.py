from flask import Flask, render_template, jsonify, request, send_from_directory
import os
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import json

app = Flask(__name__, static_folder='client', static_url_path='')

# Initialize Firebase
if os.path.exists('serviceAccountKey.json'):
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase initialized successfully.")
else:
    print("Warning: serviceAccountKey.json not found. Firebase features will fail.")
    db = None

COLLECTION_NAME = 'movies'

@app.route('/')
def game():
    return send_from_directory('client', 'index.html')

@app.route('/admin')
def admin():
    return render_template('admin.html')

@app.route('/api/movies', methods=['GET'])
def get_movies():
    if not db:
        return jsonify({"error": "Database not configured"}), 500
    
    try:
        movies_ref = db.collection(COLLECTION_NAME)
        docs = movies_ref.stream()
        
        movies = []
        for doc in docs:
            movie = doc.to_dict()
            # Map keys to handle both frontend consistencies (title vs Title) and DB schema (lowercase)
            movies.append({
                'id': doc.id,
                'title': movie.get('title'),           # For renderMovieList (expects lowercase key)
                'Title': movie.get('title'),           # For loadMovie/save (expects PascalCase key)
                'year': movie.get('year'),             # For renderMovieList
                'Year': movie.get('year'),             # For loadMovie
                'Plot': movie.get('description') or '',  # For loadMovie description (transcoding None to "")
                'HiddenIndices': movie.get('hiddenIndices', []) # For loadMovie
            })
            
        return jsonify(movies)
    except Exception as e:
        print(f"Error reading from Firestore: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/save', methods=['POST'])
def save_movie():
    if not db:
        return jsonify({"error": "Database not configured"}), 500

    try:
        data = request.json
        target_title = data.get('title')
        new_indices = data.get('hiddenIndices')
        
        if not target_title:
            return jsonify({"error": "Missing title"}), 400

        # Query to find the document by title
        movies_ref = db.collection(COLLECTION_NAME)
        query = movies_ref.where('title', '==', target_title).limit(1)
        docs = query.stream()
        
        found = False
        for doc in docs:
            found = True
            doc.reference.update({
                'hiddenIndices': new_indices
            })
            break
            
        if found:
            return jsonify({"status": "success"})
        else:
            return jsonify({"error": "Movie not found"}), 404
            
    except Exception as e:
        print(f"Error saving data: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
