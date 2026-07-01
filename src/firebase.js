import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, addDoc, getDocs, query, orderBy, limit, where, updateDoc, onSnapshot, increment } from "firebase/firestore";

// Your web app's Firebase configuration (provided by user)
const firebaseConfig = {
  apiKey: "AIzaSyAqLu7YlbDn2AkKXjihLVU8bzy4Fb61V7c",
  authDomain: "juegos-online-99b20.firebaseapp.com",
  projectId: "juegos-online-99b20",
  storageBucket: "juegos-online-99b20.firebasestorage.app",
  messagingSenderId: "942532179041",
  appId: "1:942532179041:web:eee067b965e74b4a26a620"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Collection references under 'games/tetrisMG' as requested (same format as memory_suika)
const gameDocRef = doc(db, "games", "tetrisMG");
const highscoresRef = collection(gameDocRef, "highscores");
const roomsRef = collection(gameDocRef, "rooms");

/**
 * Saves a player's high score. If the name already exists, updates only if the new score is higher.
 */
export const saveScore = async (playerName, score) => {
  try {
    const name = playerName || "Anónimo";
    const q = query(highscoresRef, where("name", "==", name));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      // User exists
      const docSnap = snapshot.docs[0];
      const data = docSnap.data();
      if (score > data.score) {
        await updateDoc(doc(highscoresRef, docSnap.id), {
          score: score,
          timestamp: new Date()
        });
      }
    } else {
      // New user record
      await addDoc(highscoresRef, {
        name: name,
        score: score,
        timestamp: new Date()
      });
    }
    return true;
  } catch (error) {
    console.error("Error saving score: ", error);
    return false;
  }
};

/**
 * Retrieves the top scores.
 */
export const getTopScores = async (topCount = 5) => {
  try {
    const q = query(highscoresRef, orderBy("score", "desc"), limit(topCount));
    const querySnapshot = await getDocs(q);
    const scores = [];
    querySnapshot.forEach((doc) => {
      scores.push({ id: doc.id, ...doc.data() });
    });
    return scores;
  } catch (error) {
    console.error("Error getting top scores: ", error);
    return [];
  }
};

/**
 * Creates a multiplayer room.
 */
export const createRoom = async (roomCode) => {
  try {
    const roomDoc = doc(roomsRef, roomCode);
    await setDoc(roomDoc, {
      player1: { score: 0, lines: 0, level: 1, grid: "", punishments: 0 },
      player2: null,
      status: 'waiting',
      createdAt: new Date()
    });
    return true;
  } catch (error) {
    console.error("Error creating room: ", error);
    return false;
  }
};

/**
 * Joins an existing multiplayer room.
 */
export const joinRoom = async (roomCode) => {
  try {
    const roomDoc = doc(roomsRef, roomCode);
    // Directly check if document exists.
    // Note: in older code we used queries, but direct getDoc or update is safer and faster.
    await updateDoc(roomDoc, {
      player2: { score: 0, lines: 0, level: 1, grid: "", punishments: 0 },
      status: 'playing'
    });
    return true;
  } catch (error) {
    console.error("Error joining room: ", error);
    return false;
  }
};

/**
 * Listens to room changes in real-time.
 */
export const listenToRoom = (roomCode, callback) => {
  const roomDoc = doc(roomsRef, roomCode);
  return onSnapshot(roomDoc, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data());
    }
  });
};

/**
 * Updates the game state for the specified player.
 */
export const updateRoomState = async (roomCode, isPlayer1, dataToUpdate, status = null) => {
  try {
    const roomDoc = doc(roomsRef, roomCode);
    const fieldPrefix = isPlayer1 ? 'player1' : 'player2';
    
    const updates = {};
    if (dataToUpdate.score !== undefined) updates[`${fieldPrefix}.score`] = dataToUpdate.score;
    if (dataToUpdate.lines !== undefined) updates[`${fieldPrefix}.lines`] = dataToUpdate.lines;
    if (dataToUpdate.level !== undefined) updates[`${fieldPrefix}.level`] = dataToUpdate.level;
    if (dataToUpdate.grid !== undefined) updates[`${fieldPrefix}.grid`] = dataToUpdate.grid;
    if (dataToUpdate.punishments !== undefined) updates[`${fieldPrefix}.punishments`] = dataToUpdate.punishments;
    if (status !== null) updates.status = status;
    
    await updateDoc(roomDoc, updates);
  } catch (error) {
    console.error("Error updating room state: ", error);
  }
};

/**
 * Sends a punishment (garbage lines) to the OTHER player.
 */
export const sendPunishment = async (roomCode, isPlayer1, count = 1) => {
  try {
    const roomDoc = doc(roomsRef, roomCode);
    const targetField = isPlayer1 ? 'player2.punishments' : 'player1.punishments';
    
    const updates = {};
    updates[targetField] = increment(count);
    await updateDoc(roomDoc, updates);
  } catch (error) {
    console.error("Error sending punishment: ", error);
  }
};
