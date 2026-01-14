
from flask import Flask, render_template, jsonify, request
import csv
import os
import json

app = Flask(__name__)

CSV_FILE = 'imdb_movies_1990_plus.csv'

@app.route('/')
def index():
    return render_template('admin.html')

@app.route('/api/movies', methods=['GET'])
def get_movies():
    movies = []
    try:
        if os.path.exists(CSV_FILE):
            with open(CSV_FILE, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                movies = list(reader)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return jsonify([])
    return jsonify(movies)

@app.route('/api/save', methods=['POST'])
def save_movie():
    try:
        data = request.json
        target_title = data.get('title')
        new_indices = data.get('hiddenIndices')
        
        if not target_title:
            return jsonify({"error": "Missing title"}), 400

        movies = []
        headers = []
        updated = False
        
        if os.path.exists(CSV_FILE):
            with open(CSV_FILE, 'r', encoding='utf-8', newline='') as f:
                reader = csv.DictReader(f)
                headers = reader.fieldnames
                movies = list(reader)
        else:
            return jsonify({"error": "CSV file not found"}), 500

        for movie in movies:
            if movie['Title'] == target_title:
                movie['HiddenIndices'] = new_indices
                updated = True
                break
        
        if updated:
            with open(CSV_FILE, 'w', encoding='utf-8', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=headers)
                writer.writeheader()
                writer.writerows(movies)
            return jsonify({"status": "success"})
        else:
            return jsonify({"error": "Movie not found"}), 404
            
    except Exception as e:
        print(f"Error saving data: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
