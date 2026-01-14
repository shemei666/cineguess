
import time
import csv
import random
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, ElementClickInterceptedException
from bs4 import BeautifulSoup

# CONFIGURATION
# Search for Feature Films, Released 1990-01-01 to present, sorted by popularity
BASE_URL = "https://www.imdb.com/search/title/?title_type=feature&release_date=1990-01-01,&sort=num_votes,desc"
CSV_FILENAME = "imdb_movies_1990_plus.csv"
TARGET_MOVIES = 1000

# Intelligent Redaction Logic Dependencies
STOPWORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'down',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'it', 'its', 'he', 'him', 'his', 'she', 'her',
    'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your', 'this', 'that', 'these', 'those', 'who', 'which',
    'what', 'where', 'when', 'why', 'how', 'much', 'many', 'few', 'little', 'all', 'some', 'any', 'no', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'as', 'into', 'just', 'over', 'out', 'while', 'about'
}

def clean_text(text):
    if text:
        return text.strip().replace('\n', ' ')
    return "N/A"

def clean_term(text):
    return "".join([c for c in text if c.isalnum() or c.isspace()]).lower()

def get_redaction_indices(plot, title):
    if not plot or plot == "N/A":
        return ""
        
    words = plot.split(' ')
    title_words = set(clean_term(title).split())
    
    hidden_indices = []
    
    for idx, word in enumerate(words):
        clean_word = clean_term(word)
        lower_word = clean_word.lower()
        
        # Skip empty or very short words
        if len(clean_word) < 2:
            continue
            
        should_hide = False
        
        # 1. Title Match (Case insensitive)
        if lower_word in title_words and lower_word not in STOPWORDS:
            should_hide = True
        
        # 2. Proper Noun Heuristic
        # Capitalized, not start of sentence, not a stopword
        is_capitalized = word[0].isupper() if word else False
        is_start = (idx == 0) or (idx > 0 and words[idx-1].endswith('.'))
        
        if not should_hide and is_capitalized and not is_start and lower_word not in STOPWORDS:
            should_hide = True
            
        # 3. Significant Word Heuristic (Long words)
        if not should_hide and len(clean_word) >= 7 and lower_word not in STOPWORDS:
            if random.random() < 0.6: # 60% chance to hide long words
                should_hide = True

        if should_hide:
            hidden_indices.append(str(idx))
            
    return '|'.join(hidden_indices)

def scrape_imdb_selenium():
    print(f"Starting Selenium scrape. Target: {TARGET_MOVIES} movies.")
    
    # Setup Chrome Driver
    options = webdriver.ChromeOptions()
    # options.add_argument('--headless') # Uncomment to run headless
    options.add_argument('--start-maximized')
    options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    
    driver = webdriver.Chrome(options=options)
    
    try:
        driver.get(BASE_URL)
        print("Page loaded. Initializing scroll loop...")
        
        # Allow initial load
        time.sleep(3)
        
        # Handle "50 more" button clicking loop
        while True:
            # Check how many items we have
            items = driver.find_elements(By.CLASS_NAME, "ipc-metadata-list-summary-item")
            count = len(items)
            print(f"  Current loaded count: {count}")
            
            if count >= TARGET_MOVIES:
                print("Target reached!")
                break
                
            try:
                # Look for the '50 more' button
                # Selector strategy: Button containing text "50 more" (case insensitive usually safer, but specific is good)
                # IMDb usually uses a class specifically for the 'See more' button
                more_button = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((By.XPATH, "//button[descendant::span[contains(text(), '50 more')]]"))
                )
                
                # Scroll to button
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", more_button)
                time.sleep(1)
                
                # Click it
                more_button.click()
                
                # Wait for content to load (simple sleep is often more robust than complex wait for generic 'something changed')
                time.sleep(random.uniform(2, 4))
                
            except (TimeoutException, NoSuchElementException):
                print("  '50 more' button not found or not clickable. Reached end of list?")
                break
            except ElementClickInterceptedException:
                print("  Click intercepted, retrying scroll...")
                driver.execute_script("window.scrollBy(0, 100);")
                time.sleep(1)
            except Exception as e:
                print(f"  Error clicking more button: {e}")
                break
        
        # Now parse the final large page
        print("Parsing final page content...")
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        
        movie_cards = soup.select('.ipc-metadata-list-summary-item')
        print(f"Found {len(movie_cards)} items in final HTML.")
        
        collected_movies = []
        seen_keys = set()
        
        for card in movie_cards:
            if len(collected_movies) >= TARGET_MOVIES:
                break
                
            try:
                # Title
                title_tag = card.select_one('.ipc-title__text')
                title = clean_text(title_tag.text).split('. ', 1)[-1] if title_tag else "Unknown"

                # Metadata
                metadata_items = card.select('.sc-b189961a-8.kLaxqf.dli-title-metadata-item, .dli-title-metadata-item, .cli-title-metadata-item')
                year = clean_text(metadata_items[0].text) if len(metadata_items) > 0 else "N/A"
                
                # De-duplication
                unique_key = (title, year)
                if unique_key in seen_keys:
                    continue
                seen_keys.add(unique_key)
                
                # Rating
                rating_tag = card.select_one('.ipc-rating-star--base, .ratingGroup--imdb-rating')
                rating = clean_text(rating_tag.text).split('(')[0].strip() if rating_tag else "N/A"

                # Plot
                plot_tag = card.select_one('.ipc-html-content-inner-div')
                plot = clean_text(plot_tag.text) if plot_tag else "N/A"
                
                # Redaction indices
                hidden_indices = get_redaction_indices(plot, title)

                collected_movies.append({
                    "Title": title,
                    "Year": year,
                    "Rating": rating,
                    "Plot": plot,
                    "HiddenIndices": hidden_indices
                })
            except Exception as e:
                continue

        # Save to CSV
        if collected_movies:
            with open(CSV_FILENAME, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=["Title", "Year", "Rating", "Plot", "HiddenIndices"])
                writer.writeheader()
                writer.writerows(collected_movies)
            print(f"\nDone! Scraped {len(collected_movies)} movies to {CSV_FILENAME}")
        else:
            print("\nNo movies collected.")
            
    except Exception as e:
        print(f"Fatal Error: {e}")
    finally:
        driver.quit()

if __name__ == "__main__":
    scrape_imdb_selenium()
