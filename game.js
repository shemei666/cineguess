// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";
import { getFirestore, collection, getDocs, query, where, documentId, limit } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

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
const db = getDatabase(app);
const firestore = getFirestore(app);
const functions = getFunctions(app);

// --- Audio Manager ---
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
        this.playTone(440, 'sine', 0.1); 
        setTimeout(() => this.playTone(554, 'sine', 0.1), 100); 
        setTimeout(() => this.playTone(659, 'sine', 0.2), 200); 
    }
    playError() { this.playTone(150, 'sawtooth', 0.3); }
    playPop() { this.playTone(800, 'triangle', 0.05); }
    playPartial() { this.playTone(600, 'sine', 0.2); }
}

// --- Levenshtein Distance ---
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
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
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

        // Check URL Params for Mode
        const urlParams = new URLSearchParams(window.location.search);
        this.roomCode = urlParams.get('room');
        this.playerId = urlParams.get('player');
        this.isMultiplayer = !!(this.roomCode && this.playerId);

        // Standard Filters (Single Player)
        this.selectedGenre = urlParams.get('genre') || 'All';
        this.minYear = parseInt(urlParams.get('minYear')) || 1990;
        this.maxYear = parseInt(urlParams.get('maxYear')) || 2030;
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
        this.submitBtn.addEventListener('click', () => this.handleGuess());
        this.skipBtn.addEventListener('click', () => this.skipRound());
        this.hintBtn.addEventListener('click', () => this.useHint());
        this.shareBtn.addEventListener('click', () => this.shareResult());
        this.homeBtn.addEventListener('click', () => window.location.href = 'index.html');
        this.inputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleGuess();
        });

        // Initialize
        if (this.isMultiplayer) {
            this.initMultiplayer();
        } else {
            this.initSinglePlayer();
        }
    }

    // --- Multiplayer Logic ---

    initMultiplayer() {
        // UI Adjustments
        this.skipBtn.style.display = 'none';
        this.hintBtn.style.display = 'none'; // No hints in MP
        this.shareBtn.style.display = 'none';
        
        // Repurpose Score Board
        document.querySelector('.score-board .label').innerText = "SCORE";
        
        // Add Timer Element
        const header = document.querySelector('header');
        const timerDiv = document.createElement('div');
        timerDiv.className = 'score-board'; 
        timerDiv.style.marginRight = '1rem';
        timerDiv.innerHTML = `<span class="label">TIME</span><span id="timer-val" class="value">--</span>`;
        header.insertBefore(timerDiv, document.querySelector('.score-board')); // Insert before Score
        this.timerEl = document.getElementById('timer-val');

        // RTDB Listener
        const roomRef = ref(db, `rooms/${this.roomCode}`);
        onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) return; // Room deleted?
            
            this.updateMultiplayerState(data);
        });
    }

    updateMultiplayerState(data) {
        const gameState = data.gameState || {};
        const player = (data.players || {})[this.playerId];
        this.isHost = player?.isHost || false;

        // 1. Update Score
        if (player) {
            this.streakEl.innerText = player.score || 0;
        }

        // 2. Round/Movie Change
        if (gameState.currentMovieId && (!this.currentMovie || this.currentMovie.id !== gameState.currentMovieId)) {
            // New Movie!
            const movieData = gameState.movieData || {};
            this.currentMovie = {
                id: gameState.currentMovieId,
                title: gameState.secretTitle, 
                description: movieData.description,
                hiddenIndices: new Set(movieData.hiddenIndices || [])
            };
            
            this.renderMultiplayerRound();
        }

        // 3. Status Handling
        if (data.status === 'game_over') {
            this.showFeedback("GAME OVER! Final Score: " + (player?.score || 0), "success", true);
            this.inputEl.disabled = true;
            this.submitBtn.disabled = true;
            return;
        }
        
        if (data.status === 'round_end') {
            this.inputEl.disabled = true;
            clearInterval(this.timerInterval);
            
            if (this.isHost) {
                this.submitBtn.disabled = false;
                this.submitBtn.innerText = "NEXT ROUND";
                this.submitBtn.onclick = () => this.triggerNextRound();
                this.showFeedback("Round Over! Start next round?", "info", true);
            } else {
                this.submitBtn.disabled = true;
                this.submitBtn.innerText = "WAITING...";
                this.showFeedback("Round Over! Waiting for host...", "info", true);
            }
            return;
        }

        // 4. Timer Sync
        if (gameState.roundEndTime && data.status === 'playing') {
            this.startTimer(gameState.roundEndTime);
        }
        
        // 5. Check if we already guessed correctly (to disable input)
        // Only if we define correctGuessers in Cloud Function properly
        if (gameState.correctGuessers && gameState.correctGuessers.includes(this.playerId)) {
            this.inputEl.disabled = true;
            this.submitBtn.disabled = true;
            this.submitBtn.innerText = "WAITING...";
            this.showFeedback("Correct! Waiting for next round...", "success", true);
        } else {
             // Reset if new round (Status is playing)
             if(data.status === 'playing') {
                 // Only reset if we were previously disabled or if it's a new movie
                 if(this.inputEl.disabled || this.submitBtn.innerText === "NEXT ROUND") {
                     this.inputEl.disabled = false;
                     this.inputEl.value = '';
                     this.submitBtn.disabled = false;
                     this.submitBtn.innerText = "GUESS";
                     this.submitBtn.onclick = () => this.handleGuess(); // Restore handler
                     this.resetFeedback();
                     this.inputEl.focus();
                 }
             }
        }
    }
    
    async triggerNextRound() {
        this.submitBtn.disabled = true;
        try {
            const nextRoundFn = httpsCallable(functions, 'nextRound');
            await nextRoundFn({ 
                roomCode: this.roomCode, 
                playerId: this.playerId 
            });
        } catch (error) {
            console.error(error);
            this.showFeedback("Error starting next round.", "error");
            this.submitBtn.disabled = false;
        }
    }

    renderMultiplayerRound() {
        this.prepareRoundState(this.currentMovie);
        this.renderDescription();
        this.descriptionEl.classList.remove('skeleton');
        this.gameCard.classList.remove('fade-out');
        this.gameCard.classList.add('fade-in');
        this.audio.playPop();
    }

    startTimer(endTime) {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        const update = () => {
            const now = Date.now();
            const left = Math.max(0, Math.ceil((endTime - now) / 1000));
            this.timerEl.innerText = left;
            
            if (left <= 10) {
                 this.timerEl.style.color = '#ff4b4b'; // Warning color
            } else {
                 this.timerEl.style.color = 'white';
            }

            if (left <= 0) {
                clearInterval(this.timerInterval);
                if (!this.inputEl.disabled) {
                    this.showFeedback("Time's Up!", "error");
                    this.inputEl.disabled = true;
                }
            }
        };
        
        update();
        this.timerInterval = setInterval(update, 1000);
    }

    // --- Single Player Logic ---

    async initSinglePlayer() {
        await this.loadNewRound(true);
    }

    async loadNewRound(isInitial = false) {
        if (!isInitial) {
            this.gameCard.classList.add('fade-out');
            await new Promise(r => setTimeout(r, 300));
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

    async fetchRandomMovie() {
        this.isLoading = true;
        this.showFeedback("Loading next movie...", "info", true);
        this.descriptionEl.classList.add('skeleton');
        this.descriptionEl.innerHTML = '&nbsp;';

        try {
            const moviesCol = collection(firestore, 'movies');
            let q;
            let snapshot;
            let foundMovie = null;
            let attempts = 0;

            while (!foundMovie && attempts < 5) {
                attempts++;
                if (this.selectedGenre !== 'All') {
                    q = query(moviesCol, where('genre', 'array-contains', this.selectedGenre), limit(50));
                } else {
                    const randomId = this.generateRandomId();
                    q = query(moviesCol, where(documentId(), '>=', randomId), limit(50));
                }
                
                snapshot = await getDocs(q);
                 if (snapshot.empty && this.selectedGenre === 'All') {
                    snapshot = await getDocs(query(moviesCol, limit(50)));
                }

                if (snapshot.empty) break;

                const candidates = [];
                snapshot.forEach(doc => {
                    const d = doc.data();
                    const yearVal = d.year || 0;
                    const ratingVal = d.rating || 0;
                    if (yearVal >= this.minYear && yearVal <= this.maxYear && ratingVal >= this.minRating) {
                        candidates.push(d);
                    }
                });

                if (candidates.length > 0) {
                    foundMovie = candidates[Math.floor(Math.random() * candidates.length)];
                } else {
                     console.log("Retry fetch...");
                }
            }

            if (!foundMovie) throw new Error("No movies found.");

            return {
                title: foundMovie.title,
                description: foundMovie.description,
                hiddenIndices: new Set(foundMovie.hiddenIndices || [])
            };

        } catch (error) {
            console.error(error);
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

    generateRandomId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let autoId = '';
        for (let i = 0; i < 20; i++) autoId += chars.charAt(Math.floor(Math.random() * chars.length));
        return autoId;
    }

    // --- Shared/Core Logic ---

    prepareRoundState(movie) {
        const description = movie.description;
        const hiddenIndices = movie.hiddenIndices || new Set();
        const words = description.split(' ');

        this.wordState = words.map((word, index) => {
            const cleanWord = word.replace(/[^\w]/g, '');
            const shouldRedact = hiddenIndices.has(index);
            return {
                original: word, // Keep original casing/punctuation
                clean: cleanWord,
                isHidden: shouldRedact
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
        this.audio.playPop();
    }

    handleGuess() {
        if (this.isMultiplayer) {
            this.handleGuessMultiplayer();
        } else {
            this.handleGuessSinglePlayer();
        }
    }

    async handleGuessMultiplayer() {
        const userGuess = this.inputEl.value.trim();
        if(!userGuess) return;
        
        // Optimistic UI? Maybe not for validation, but for interaction
        this.submitBtn.disabled = true; // Prevent double submit
        
        try {
            const submitGuessFn = httpsCallable(functions, 'submitGuess');
            const result = await submitGuessFn({
                roomCode: this.roomCode,
                guess: userGuess,
                playerId: this.playerId
            });
            
            if (result.data.correct) {
                this.audio.playWin();
                this.showFeedback(`Correct! +${result.data.scoreEarned}`, "success");
                // Reveal logic is handled partly by waiting for server sync or local reveal
                // For MP: Reveal the movie locally immediately for satisfaction? 
                // We'll rely on the updateMultiplayerState disabling the input. 
                confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
            } else {
                this.audio.playError();
                this.gameCard.classList.add('shake-anim');
                setTimeout(() => this.gameCard.classList.remove('shake-anim'), 500);
                this.submitBtn.disabled = false;
                this.showFeedback(result.data.message || "Incorrect!", "error");
            }
        } catch (error) {
            console.error(error);
            this.submitBtn.disabled = false;
            this.showFeedback("Error submitting guess.", "error");
        }
    }

    handleGuessSinglePlayer() {
        const userGuess = this.inputEl.value.trim().toLowerCase();
        if (!userGuess) return;

        const cleanTitle = this.currentMovie.title.toLowerCase().replace(/[^\w]/g, '');
        const cleanGuess = userGuess.replace(/[^\w]/g, '');

        if (cleanGuess === cleanTitle) {
            this.handleWin();
        } else {
             // Partial Match (Levenshtein)
            const dist = levenshtein(cleanGuess, cleanTitle);
            if (dist <= 2 && cleanTitle.length > 5) {
                this.showFeedback("So close! Check your spelling.", "info");
                this.audio.playPartial();
            } else {
                this.handleLoss();
            }
        }
    }

    handleWin() {
        this.streak++;
        this.updateStreak();
        this.showFeedback("Correct! 🎬", "success");
        this.audio.playWin();
        this.revealDescription();
        this.gameCard.classList.add('pop-anim');
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
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

    revealDescription() {
        this.descriptionEl.innerHTML = this.currentMovie.description;
    }

    useHint() {
        if(this.isMultiplayer) return;
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

    skipRound() {
        if(this.isMultiplayer) return;
        this.streak = 0;
        this.updateStreak();
        this.showFeedback(`The movie was: ${this.currentMovie.title}`, "error");
        this.revealDescription();
        setTimeout(() => this.loadNewRound(), 3000);
    }

    showFeedback(msg, type, persist = false) {
        this.feedbackEl.textContent = msg;
        this.feedbackEl.className = `feedback visible ${type}`;
        if (!persist) {
             // Auto hide logic if needed
        }
    }

    resetFeedback() {
        this.feedbackEl.className = 'feedback hidden';
    }

    updateStreak() {
        this.streakEl.textContent = this.streak;
    }

    shareResult() {
        // ... (Existing Share Logic - Optional to keep, but simplified for brevity in this rewrite)
        // I will re-implement the simplified version
        const text = `I'm playing CineGuess! \nStreak: ${this.streak} 🔥`;
        if (navigator.share) {
            navigator.share({ title: 'CineGuess', text: text, url: window.location.href }).catch(e => console.log(e));
        } else if (navigator.clipboard) {
             navigator.clipboard.writeText(text).then(() => this.showFeedback("Copied!", "info"));
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CineGuessGame();
});
