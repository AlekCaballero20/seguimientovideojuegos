import { auth, googleProvider } from "./firebase.config.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export const ALLOWED_EMAIL = "alekcaballeromusic@gmail.com";

export function isAllowedUser(user) {
  return user?.email?.toLowerCase() === ALLOWED_EMAIL;
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function logout() {
  return signOut(auth);
}
