// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js";
import { getFirestore, collection, getDocs, query, where, orderBy, limit, startAt, documentId } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

// Your web app's Firebase configuration
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

// --- Audio Manager (Synthesized Sounds) ---
class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    playTone(freq, type, duration) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playWin() {
        // Major Arpeggio
        this.playTone(440, 'sine', 0.1); // A4
        setTimeout(() => this.playTone(554, 'sine', 0.1), 100); // C#5
        setTimeout(() => this.playTone(659, 'sine', 0.2), 200); // E5
    }

    playError() {
        this.playTone(150, 'sawtooth', 0.3);
    }

    playPop() {
        this.playTone(800, 'triangle', 0.05);
    }

    playPartial() {
        this.playTone(600, 'sine', 0.2);
    }
}

// --- Levenshtein Distance for Partial Matching ---
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    Math.min(matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j] + 1)); // deletion
            }
        }
    }
    return matrix[b.length][a.length];
}

class CineGuessGame {
    constructor() {
        this.currentMovie = null;
        this.streak = 0;
        this.isLoading = false;
        this.wordState = [];
        this.audio = new SoundManager();

        // Check URL Params for Mode/Genre
        const urlParams = new URLSearchParams(window.location.search);
        this.selectedGenre = urlParams.get('genre') || 'All';
        this.minYear = parseInt(urlParams.get('minYear')) || 1990;
        this.maxYear = parseInt(urlParams.get('maxYear')) || 2030; // Default filter upper bound
        this.minRating = parseFloat(urlParams.get('minRating')) || 0;

        // DOM Elements
        this.descriptionEl = document.getElementById('movie-description');
        this.inputEl = document.getElementById('guess-input');
        this.submitBtn = document.getElementById('submit-btn');
        this.skipBtn = document.getElementById('skip-btn');
        this.hintBtn = document.getElementById('hint-btn');
        this.shareBtn = document.getElementById('share-btn');
        this.homeBtn = document.getElementById('home-btn');
        this.feedbackEl = document.getElementById('feedback-message');
        this.streakEl = document.getElementById('streak-counter');
        this.gameCard = document.getElementById('game-card');

        // Bind events
        this.submitBtn.addEventListener('click', () => this.checkGuess());
        this.skipBtn.addEventListener('click', () => this.skipRound());
        this.hintBtn.addEventListener('click', () => this.useHint());
        this.shareBtn.addEventListener('click', () => this.shareResult());
        this.homeBtn.addEventListener('click', () => window.location.href = 'menu.html');
        this.inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.checkGuess();
        });

        // UI Prep


        this.initGame();
    }

    async initGame() {
        await this.loadNewRound(true);
    }

    generateRandomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let autoId = '';
        for (let i = 0; i < 20; i++) {
            autoId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return autoId;
    }

    async fetchRandomMovie() {
        this.isLoading = true;
        this.showFeedback("Loading next movie...", "info", true); // true = persist

        // Skeleton state
        this.descriptionEl.classList.add('skeleton');
        this.descriptionEl.innerHTML = '&nbsp;'; // Maintain height

        try {
            const moviesCol = collection(db, 'movies');
            let q;
            let snapshot;

            // STRATEGY: 
            // 1. Fetch a BATCH of movies based on basic criteria (Genre or Random ID).
            // 2. Client-side filter for Year/Rating.
            // 3. Repeat if no match found (safeguard).

            let attempts = 0;
            const MAX_ATTEMPTS = 5;
            let foundMovie = null;

            while (!foundMovie && attempts < MAX_ATTEMPTS) {
                attempts++;

                // Standard Mode
                if (this.selectedGenre !== 'All') {
                    // Fetch batch of 20 for this genre
                    // Note: We can't easily startAt random ID with genre filter without composite index on everything.
                    // So we just fetch a batch. To randomize, we could add an offset if needed, but for now just limit 20.
                    // Randomness comes from client picking from the 20.
                    // WARNING: This always fetches the SAME 20 if we don't vary the query.
                    // Improvement: Use 'random' field if we had one.
                    // For now: Just fetch limit 50.
                    q = query(moviesCol, where('genre', 'array-contains', this.selectedGenre), limit(50));
                } else {
                    // Truly random start for All Genres
                    const randomId = this.generateRandomId();
                    q = query(moviesCol, where(documentId(), '>=', randomId), limit(50));
                }

                snapshot = await getDocs(q);

                // Wrap-around logic (only for random mode)
                if (snapshot.empty && this.selectedGenre === 'All') {
                    snapshot = await getDocs(query(moviesCol, limit(50)));
                }

                if (snapshot.empty) break; // Total empty DB?

                // Filter Loop
                const candidates = [];
                snapshot.forEach(doc => {
                    const d = doc.data();

                    // Apply filters
                    const yearVal = d.year || 0;
                    const ratingVal = d.rating || 0;

                    const yearMatch = yearVal >= this.minYear && yearVal <= this.maxYear;
                    const ratingMatch = ratingVal >= this.minRating;

                    if (yearMatch && ratingMatch) {
                        candidates.push(d);
                    }
                });

                if (candidates.length > 0) {
                    // Pick random
                    foundMovie = candidates[Math.floor(Math.random() * candidates.length)];
                } else {
                    // If we filtered everyone out, loop again. 
                    // Ideally we'd offset the query, but with firestore random ID seek, simple retry with new randomId works.
                    // If Genre mode: we are stuck fetching same batch unless we random seek WITHIN genre (hard).
                    // For prototype: we assume 50 limit is enough to find ONE.
                    console.log("No movies matched filters in this batch, retrying...");
                }


            }

            if (!foundMovie) {
                throw new Error("No movies found matching criteria.");
            }

            return {
                title: foundMovie.title,
                description: foundMovie.description,
                hiddenIndices: new Set(foundMovie.hiddenIndices || [])
            };

        } catch (error) {
            console.error(error);
            // Fallback
            return {
                title: "The Matrix (Fallback)",
                description: "A computer hacker learns from mysterious rebels about the true nature of his reality.",
                hiddenIndices: new Set([2, 5, 8, 9, 12])
            };
        } finally {
            this.isLoading = false;
            this.descriptionEl.classList.remove('skeleton');
        }
    }

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
        this.audio.playPop(); // Subtle sound on render
    }

    useHint() {
        this.streak = 0;
        this.updateStreak();

        const hiddenIndices = this.wordState
            .map((item, index) => item.isHidden ? index : -1)
            .filter(index => index !== -1);

        if (hiddenIndices.length === 0) return;

        const randomIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
        this.wordState[randomIndex].isHidden = false;

        this.renderDescription();
        this.audio.playPop();
    }

    async loadNewRound(isInitial = false) {
        // Transition Out
        if (!isInitial) {
            this.gameCard.classList.add('fade-out');
            await new Promise(r => setTimeout(r, 300)); // wait for fade
        }

        this.currentMovie = await this.fetchRandomMovie();
        this.prepareRoundState(this.currentMovie);
        this.renderDescription();

        this.inputEl.value = '';
        this.inputEl.focus();
        this.resetFeedback();
        this.gameCard.classList.remove('shake-anim', 'pop-anim', 'fade-out');
        this.gameCard.classList.add('fade-in');
    }

    checkGuess() {
        const userGuess = this.inputEl.value.trim().toLowerCase();
        if (!userGuess) return;

        const cleanTitle = this.currentMovie.title.toLowerCase().replace(/[^\w]/g, '');
        const cleanGuess = userGuess.replace(/[^\w]/g, '');

        // Exact Match
        if (cleanGuess === cleanTitle) {
            this.handleWin();
            return;
        }

        // Partial Match (Levenshtein)
        // Allow distance <= 2 for titles > 5 chars
        const dist = levenshtein(cleanGuess, cleanTitle);
        if (dist <= 2 && cleanTitle.length > 5) {
            this.showFeedback("So close! Check your spelling.", "info");
            this.audio.playPartial();
            return;
        }

        this.handleLoss();
    }

    handleWin() {
        this.streak++;
        this.updateStreak();
        this.showFeedback("Correct! 🎬", "success");

        this.audio.playWin();
        this.revealDescription();
        this.gameCard.classList.add('pop-anim');

        // Confetti!
        confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
        });

        setTimeout(() => this.loadNewRound(), 2500);
    }

    handleLoss() {
        this.streak = 0;
        this.updateStreak();

        this.showFeedback("Incorrect, try again!", "error");
        this.audio.playError();
        this.gameCard.classList.add('shake-anim');
        setTimeout(() => this.gameCard.classList.remove('shake-anim'), 500);
    }

    skipRound() {


        this.streak = 0;
        this.updateStreak();
        this.showFeedback(`The movie was: ${this.currentMovie.title}`, "error");
        this.revealDescription();

        setTimeout(() => this.loadNewRound(), 3000);
    }

    revealDescription() {
        this.descriptionEl.innerHTML = this.currentMovie.description;
    }

    showFeedback(msg, type, persist = false) {
        this.feedbackEl.textContent = msg;
        this.feedbackEl.className = `feedback visible ${type}`;

        if (!persist) {
            // Logic to auto-hide handled by resets or standard timeouts usually
        }
    }

    resetFeedback() {
        this.feedbackEl.className = 'feedback hidden';
    }

    updateStreak() {
        this.streakEl.textContent = this.streak;
    }

    shareResult() {
        const text = `I'm playing CineGuess! \nStreak: ${this.streak} 🔥\nCan you beat me?`;

        if (navigator.share) {
            navigator.share({
                title: 'CineGuess',
                text: text,
                url: window.location.href
            }).catch(err => {
                console.error("Share failed:", err);
            });
        } else {
            // Robust Clipboard Fallback
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    this.showFeedback("Copied to clipboard!", "info");
                }).catch(err => {
                    console.error("Clipboard failed:", err);
                    this.fallbackCopy(text);
                });
            } else {
                this.fallbackCopy(text);
            }
        }
    }

    fallbackCopy(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";  // Avoid scrolling to bottom
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            this.showFeedback("Copied to clipboard!", "info");
        } catch (err) {
            console.error('Fallback copy failed', err);
            this.showFeedback("Could not copy.", "error");
        }
        document.body.removeChild(textArea);
    }
}

// Start game
document.addEventListener('DOMContentLoaded', () => {
    new CineGuessGame();
});
