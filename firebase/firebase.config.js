import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAwhBNpu_yDAEwkj-FcUSlks2fg3wGaSsM",
  authDomain: "seguimiento-de-videojuegos.firebaseapp.com",
  projectId: "seguimiento-de-videojuegos",
  storageBucket: "seguimiento-de-videojuegos.firebasestorage.app",
  messagingSenderId: "978611219720",
  appId: "1:978611219720:web:84f3d267df5e2fe54a50bd"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
