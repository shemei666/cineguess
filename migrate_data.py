import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import csv
import os
import random

# Initialize Firebase
if os.path.exists('serviceAccountKey.json'):
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase initialized successfully.")
else:
    print("Error: serviceAccountKey.json not found.")
    exit(1)

CSV_FILENAME = "imdb_movies_1990_plus.csv"
COLLECTION_NAME = 'movies'

def migrate():
    if not os.path.exists(CSV_FILENAME):
        print(f"{CSV_FILENAME} not found. Run scrape_imdb.py first.")
        return

    print(f"Reading {CSV_FILENAME}...")
    
    batch = db.batch()
    count = 0
    total_batch_count = 0
    
    with open(CSV_FILENAME, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Create a clean dictionary
            try:
                # Parse hidden indices
                hidden_indices = []
                if row['HiddenIndices']:
                    hidden_indices = [int(x) for x in row['HiddenIndices'].split('|') if x]

                # Parse Genre (Handle multiple genres from pipe-separated string)
                genre_raw = row.get('Genre', 'Unknown')
                genre_list = []
                
                if genre_raw and genre_raw != 'Unknown' and genre_raw != 'Action':
                    # Real scraped data found
                    genre_list = genre_raw.split('|')
                else:
                    # Fallback for demo/testing if data missing
                    genre_list = [random.choice(['Action', 'Sci-Fi', 'Drama', 'Comedy', 'Horror', 'Thriller'])]

                # Parse Numbers
                try:
                    year_val = int(row['Year'])
                except:
                    year_val = 0
                    
                try:
                    rating_val = float(row['Rating'])
                except:
                    rating_val = 0.0

                doc_data = {
                    'title': row['Title'],
                    'title_lower': row['Title'].lower(), # For easier searching
                    'year': year_val,
                    'rating': rating_val, # Number
                    'genre': genre_list,
                    'description': row['Plot'],
                    'hiddenIndices': hidden_indices,
                    'timestamp': firestore.SERVER_TIMESTAMP
                }
                
                # Create a new document reference
                doc_ref = db.collection(COLLECTION_NAME).document()
                batch.set(doc_ref, doc_data)
                
                count += 1
                
                # Commit batches of 500
                if count >= 400:
                    batch.commit()
                    print(f"Committed batch of {count} movies...")
                    batch = db.batch()
                    count = 0
                    total_batch_count += 1
                    
            except Exception as e:
                print(f"Skipping row due to error: {e}")
                continue

    # Commit final batch
    if count > 0:
        batch.commit()
        print(f"Committed final batch of {count} movies.")
        
    print("Migration complete!")

if __name__ == "__main__":
    confirm = input("This will upload data to Firestore 'movies' collection. Proceed? (y/n): ")
    if confirm.lower() == 'y':
        migrate()
    else:
        print("Cancelled.")
