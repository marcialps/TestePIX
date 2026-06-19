import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, updateEmail } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAUFlv86NbTiiVahUY_q4lHS3qPFLaq3Ow",
  authDomain: "barbersaas-5fb6d.firebaseapp.com",
  projectId: "barbersaas-5fb6d",
  storageBucket: "barbersaas-5fb6d.firebasestorage.app",
  messagingSenderId: "194431363299",
  appId: "1:194431363299:web:cb200a7ffd6f48ad38bdd6",
  measurementId: "G-SH5TEXM4M8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { app, db, auth, googleProvider, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged, updateProfile, Timestamp, sendPasswordResetEmail, updateEmail };
