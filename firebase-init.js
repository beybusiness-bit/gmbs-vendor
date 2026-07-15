import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit,
  getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC8uy09XOeEYIs1m3Rga5BMqd7gS7o3roI',
  authDomain: 'beyhome-admin.firebaseapp.com',
  projectId: 'beyhome-admin',
  storageBucket: 'beyhome-admin.firebasestorage.app',
  messagingSenderId: '849320781553',
  appId: '1:849320781553:web:5363f137447f791aaa2b50',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit,
  getDocs, serverTimestamp,
};
