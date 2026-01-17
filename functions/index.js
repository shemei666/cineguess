const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();
const firestore = admin.firestore();

// --- Room Management ---

exports.createRoom = onCall(async (request) => {
  const username = request.data.username;
  if (!username) {
    throw new HttpsError("invalid-argument", "The function must be called with a 'username'.");
  }
  const config = request.data.config || {};

  // Generate Room Code (4 letters)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let roomCode = "";
  for (let i = 0; i < 4; i++) {
    roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const roomRef = db.ref(`rooms/${roomCode}`);
  const createdAt = Date.now();

  const uid = request.auth ? request.auth.uid : "host_" + Math.random().toString(36).substr(2, 9);

  await roomRef.set({
    status: "waiting",
    createdAt: createdAt,
    config: config,
    players: {
      [uid]: {
        username: username,
        isHost: true,
        score: 0,
        isOnline: true,
      },
    },
    gameState: {
      round: 1,
      totalRounds: 5,
      roundEndTime: 0,
      correctGuessers: [],
    },
  });

  return { roomCode: roomCode, playerId: uid };
});

exports.joinRoom = onCall(async (request) => {
  const username = request.data.username;
  const roomCode = (request.data.roomCode || "").toUpperCase();

  if (!username || !roomCode) {
    throw new HttpsError("invalid-argument", "Missing username or roomCode.");
  }

  const roomRef = db.ref(`rooms/${roomCode}`);
  const snapshot = await roomRef.once("value");
  if (!snapshot.exists()) {
    throw new HttpsError("not-found", "Room not found.");
  }

  const roomData = snapshot.val();
  if (roomData.status !== "waiting") {
    throw new HttpsError("failed-precondition", "Room is not open for joining.");
  }

  const uid = request.auth ? request.auth.uid : "player_" + Math.random().toString(36).substr(2, 9);

  await roomRef.child(`players/${uid}`).set({
    username: username,
    isHost: false,
    score: 0,
    isOnline: true,
  });

  return { success: true, playerId: uid };
});

// --- Game Logic ---

async function getRandomMovie(config) {
  // config: { genre, minYear, maxYear, minRating }
  const moviesCol = firestore.collection("movies");
  const q = moviesCol;

  // Note: Firestore random access with filters is tricky.
  // For simplicity in Prototype: Fetch a batch using a random ID offset logic, then filter in memory (server-side).

  // Generate Random ID
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let randomId = "";
  for (let i = 0; i < 20; i++) randomId += chars.charAt(Math.floor(Math.random() * chars.length));

  // Try multiple times if empty
  for (let attempt = 0; attempt < 3; attempt++) {
    let qs = q.where(admin.firestore.FieldPath.documentId(), ">=", randomId).limit(10);

    if (config.genre && config.genre !== "All") {
      qs = moviesCol.where("genre", "array-contains", config.genre).limit(20); // Can't easily mix random ID + array-contains
    }

    let snapshot = await qs.get();
    if (snapshot.empty) {
      // Wrap around
      snapshot = await moviesCol.limit(10).get();
    }

    if (!snapshot.empty) {
      const candidates = [];
      snapshot.forEach((doc) => {
        const d = doc.data();
        const year = d.year || 0;
        const rating = d.rating || 0;

        if (
          year >= (config.minYear || 1900) &&
          year <= (config.maxYear || 2099) &&
          rating >= (config.minRating || 0)
        ) {
          candidates.push({ id: doc.id, ...d });
        }
      });

      if (candidates.length > 0) {
        // Return random candidate
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    // Regenerate randomId for next attempt if generic
    randomId = "";
    for (let i = 0; i < 20; i++) randomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Fallback if absolutely nothing found
  return {
    id: "fallback",
    title: "The Matrix",
    description:
      "A computer hacker learns from mysterious rebels about the true nature of his reality.",
    hiddenIndices: [2, 5, 8, 9, 12],
  };
}

exports.startGame = onCall(async (request) => {
  const roomCode = request.data.roomCode;
  const uid = request.auth ? request.auth.uid : request.data.playerId; // Allow manual playerId for anon

  const roomRef = db.ref(`rooms/${roomCode}`);
  const snapshot = await roomRef.once("value");
  if (!snapshot.exists()) throw new HttpsError("not-found", "Room not found.");

  const room = snapshot.val();
  const player = room.players[uid];
  if (!player || !player.isHost) {
    throw new HttpsError("permission-denied", "Only host can start game.");
  }

  const movie = await getRandomMovie(room.config || {});
  const ROUND_DURATION = 60000; // 60s

  await roomRef.update({
    status: "playing",
    "gameState/round": 1,
    "gameState/currentMovieId": movie.id,
    "gameState/movieData": {
      description: movie.description,
      hiddenIndices: movie.hiddenIndices || [],
    },
    "gameState/secretTitle": movie.title,
    "gameState/roundEndTime": Date.now() + ROUND_DURATION,
    "gameState/correctGuessers": [],
  });

  return { success: true };
});

exports.submitGuess = onCall(async (request) => {
  const roomCode = request.data.roomCode;
  const guess = (request.data.guess || "").toLowerCase().trim();
  const uid = request.auth ? request.auth.uid : request.data.playerId;

  const roomRef = db.ref(`rooms/${roomCode}`);
  const snapshot = await roomRef.once("value");
  if (!snapshot.exists()) throw new HttpsError("not-found", "Room not found.");

  const room = snapshot.val();
  const gameState = room.gameState;

  // Time Check
  const now = Date.now();
  if (now > gameState.roundEndTime) {
    return { correct: false, message: "Time's up!" };
  }

  // Duplicate Check
  if (gameState.correctGuessers && gameState.correctGuessers.includes(uid)) {
    return { correct: true, message: "Already guessed!" };
  }

  // Fuzzy Match Logic
  const secretTitle = (gameState.secretTitle || "").toLowerCase().replace(/[^\w]/g, "");
  const cleanGuess = guess.replace(/[^\w]/g, "");

  if (cleanGuess !== secretTitle) {
    return { correct: false };
  }

  // Correct! Calculate Score.
  const timeLeft = gameState.roundEndTime - now;
  const maxTime = 60000;
  // Score Formula: Base 100 + up to 900 bonus for speed.
  const timeRatio = Math.max(0, timeLeft / maxTime);
  const scoreToAdd = 100 + Math.floor(900 * timeRatio);

  // Update Player Score
  const playerRef = roomRef.child(`players/${uid}`);
  await playerRef.child("score").transaction((current) => (current || 0) + scoreToAdd);

  // Add to correct guessers
  const guessersRef = roomRef.child("gameState/correctGuessers");
  // RTDB arrays can be tricky using transaction
  await guessersRef.transaction((guessers) => {
    guessers = guessers || [];
    if (!guessers.includes(uid)) guessers.push(uid);
    return guessers;
  });

  // Validated Correct
  // Check if ALL players have guessed
  const playerIds = Object.keys(room.players || {});
  const updatedGuessersSnap = await guessersRef.get();
  const updatedGuessers = updatedGuessersSnap.val() || [];

  if (updatedGuessers.length >= playerIds.length) {
    // All guessed! End Round Early.
    // Update status to 'round_end'
    await roomRef.update({
      status: "round_end",
    });
  }

  return { correct: true, scoreEarned: scoreToAdd };
});

exports.nextRound = onCall(async (request) => {
  const roomCode = request.data.roomCode;
  const uid = request.auth ? request.auth.uid : request.data.playerId;

  const roomRef = db.ref(`rooms/${roomCode}`);
  const snapshot = await roomRef.once("value");
  if (!snapshot.exists()) throw new HttpsError("not-found", "Room not found.");

  const room = snapshot.val();
  if (room.players[uid] && !room.players[uid].isHost) {
    throw new HttpsError("permission-denied", "Only host can next round.");
  }

  const currentRound = room.gameState.round;
  if (currentRound >= room.gameState.totalRounds) {
    await roomRef.update({ status: "game_over" });
    return { gameOver: true };
  }

  // Next Round
  const nextRoundNum = currentRound + 1;
  const movie = await getRandomMovie(room.config || {});
  const ROUND_DURATION = 60000;

  await roomRef.update({
    status: "playing",
    "gameState/round": nextRoundNum,
    "gameState/currentMovieId": movie.id,
    "gameState/movieData": {
      description: movie.description,
      hiddenIndices: movie.hiddenIndices || [],
    },
    "gameState/secretTitle": movie.title,
    "gameState/roundEndTime": Date.now() + ROUND_DURATION,
    "gameState/correctGuessers": [],
  });

  return { success: true, round: nextRoundNum };
});
