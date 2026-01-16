
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyC-t05JZI_A35C73OUh4Hj-3DgpLQbE2m8",
    authDomain: "cineguess-db.firebaseapp.com",
    projectId: "cineguess-db",
    storageBucket: "cineguess-db.firebasestorage.app",
    messagingSenderId: "312520735771",
    appId: "1:312520735771:web:62ff4b138c5da008dc8cbe",
    measurementId: "G-QW14ZVKXM0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

const API_URL = '/api/movies';

// Fallback data in case API load fails
const FALLBACK_MOVIES = [
    {
        title: "The Matrix",
        description: "A computer hacker learns from mysterious rebels about the true nature of his reality and his role in the war against its controllers.",
        hiddenIndices: new Set([2, 5, 8, 9, 12, 13, 14, 15, 17, 21, 23])
    },
    {
        title: "Inception",
        description: "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.",
        hiddenIndices: new Set([1, 4, 11, 25, 29])
    },
    {
        title: "The Lion King",
        description: "Lion prince Simba and his father are targeted by his bitter uncle, who wants to ascend the throne himself.",
        hiddenIndices: new Set([0, 1, 2, 5, 12])
    }
];

class CineGuessGame {
    constructor() {
        this.movies = [];
        this.currentMovie = null;
        this.streak = 0;
        this.isLoading = false;
        this.wordState = []; // New state for word redaction

        // DOM Elements
        this.descriptionEl = document.getElementById('movie-description');
        this.inputEl = document.getElementById('guess-input');
        this.submitBtn = document.getElementById('submit-btn');
        this.skipBtn = document.getElementById('skip-btn');
        this.hintBtn = document.getElementById('hint-btn'); // New Hint Button
        this.feedbackEl = document.getElementById('feedback-message');
        this.streakEl = document.getElementById('streak-counter');
        this.gameCard = document.getElementById('game-card');

        // Bind events
        this.submitBtn.addEventListener('click', () => this.checkGuess());
        this.skipBtn.addEventListener('click', () => this.skipRound());
        this.hintBtn.addEventListener('click', () => this.useHint()); // Bind hint
        this.inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.checkGuess();
        });

        this.initGame();
    }

    async initGame() {
        this.showFeedback("Loading movies database...", "info");
        await this.fetchMovies();

        if (this.movies.length > 0) {
            this.resetFeedback();
            this.loadNewRound();
        } else {
            this.showFeedback("Failed to load database. Using offline backup.", "error");
            this.movies = [...FALLBACK_MOVIES];
            setTimeout(() => {
                this.resetFeedback();
                this.loadNewRound();
            }, 2000);
        }
    }

    async fetchMovies() {
        try {
            const moviesCol = collection(db, 'movies');
            const snapshot = await getDocs(moviesCol);

            if (snapshot.empty) {
                throw new Error("No movies found in Firestore");
            }

            this.movies = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    title: data.title,
                    description: data.description,
                    hiddenIndices: new Set(data.hiddenIndices || [])
                };
            });

            console.log(`Loaded ${this.movies.length} movies from Firestore.`);

        } catch (error) {
            console.error("Error loading movies from Firestore:", error);
            this.movies = [...FALLBACK_MOVIES];
        }
    }

    // Removed CSV Parser as we now use JSON API
    getRandomMovie() {
        if (this.movies.length === 0) return FALLBACK_MOVIES[0];
        return this.movies[Math.floor(Math.random() * this.movies.length)];
    }

    // New State-based Logic
    prepareRoundState(movie) {
        const description = movie.description;
        const hiddenIndices = movie.hiddenIndices || new Set();
        const words = description.split(' ');

        this.wordState = words.map((word, index) => {
            const cleanWord = word.replace(/[^\w]/g, '');

            const shouldRedact = hiddenIndices.has(index);

            return {
                original: word,
                clean: cleanWord,
                isHidden: shouldRedact,
                redactionType: 'pre-computed'
            };
        });
    }

    renderDescription() {
        const html = this.wordState.map(item => {
            if (item.isHidden) {
                return '<span class="redacted">REDACTED</span>';
            }
            return item.original;
        }).join(' ');

        this.descriptionEl.innerHTML = html;
    }

    useHint() {
        this.streak = 0;
        // Find all currently hidden words
        const hiddenIndices = this.wordState
            .map((item, index) => item.isHidden ? index : -1)
            .filter(index => index !== -1);

        if (hiddenIndices.length === 0) {
            this.showFeedback("No more words to reveal!", "info");
            return;
        }

        // Pick random hidden word
        const randomIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];

        // Reveal it
        this.wordState[randomIndex].isHidden = false;

        // Re-render
        this.renderDescription();
    }

    loadNewRound() {
        this.currentMovie = this.getRandomMovie();

        // Fade out transition could go here
        // Build state
        this.prepareRoundState(this.currentMovie);

        // Render
        this.renderDescription();

        this.inputEl.value = '';
        this.inputEl.focus();
        this.resetFeedback();

        // Reset card state if it was popped/shaken
        this.gameCard.classList.remove('shake-anim', 'pop-anim');
    }

    checkGuess() {
        const userGuess = this.inputEl.value.trim().toLowerCase();

        if (!userGuess) return;

        // Basic fuzzy title matching (ignoring punctuation/case)
        const cleanTitle = this.currentMovie.title.toLowerCase().replace(/[^\w]/g, '');
        const cleanGuess = userGuess.replace(/[^\w]/g, '');

        if (cleanGuess === cleanTitle) {
            this.handleWin();
        } else {
            this.handleLoss();
        }
    }

    handleWin() {
        this.streak++;
        this.updateStreak();
        this.showFeedback("Correct! 🎬", "success");
        this.revealDescription();
        this.gameCard.classList.add('pop-anim');

        setTimeout(() => {
            this.loadNewRound();
        }, 2000);
    }

    handleLoss() {
        this.streak = 0;
        this.showFeedback("Incorrect, try again!", "error");
        this.gameCard.classList.add('shake-anim');

        // Remove animation class so it can be re-triggered
        setTimeout(() => {
            this.gameCard.classList.remove('shake-anim');
        }, 500);
    }

    skipRound() {
        this.streak = 0;
        this.updateStreak();
        this.showFeedback(`The movie was: ${this.currentMovie.title}`, "error");
        this.revealDescription();

        setTimeout(() => {
            this.loadNewRound();
        }, 2500);
    }

    revealDescription() {
        this.descriptionEl.innerHTML = this.currentMovie.description;
    }

    showFeedback(msg, type) {
        this.feedbackEl.textContent = msg;
        this.feedbackEl.className = `feedback visible ${type}`;
    }

    resetFeedback() {
        this.feedbackEl.className = 'feedback hidden';
    }

    updateStreak() {
        this.streakEl.textContent = this.streak;
    }
}

// Start game
document.addEventListener('DOMContentLoaded', () => {
    new CineGuessGame();
});
