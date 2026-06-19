import { auth, db, doc, getDoc, setDoc, updateDoc, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, googleProvider, signInWithPopup } from './firebase-config.js';
import { DB } from './db.js';

export const Auth = {
  cur: null,
  
  async init(callback) {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Busca documento do usuário no Firestore
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const userData = docSnap.data();
          // Se o email no Firebase Auth for diferente do Firestore, atualiza o Firestore
          // Firebase Auth é a fonte de verdade para o email
          if (user.email && userData.email !== user.email) {
            console.log('[Auth] Syncing email from Firebase Auth to Firestore:', user.email);
            try {
              await updateDoc(docRef, { email: user.email });
              userData.email = user.email;
            } catch (err) {
              console.error('[Auth] Error syncing email to Firestore:', err);
            }
          }
          this.cur = { id: user.uid, ...userData };
        } else {
          // Fallback, caso algo dê errado no registro
          this.cur = { id: user.uid, name: user.displayName, email: user.email, role: 'customer' };
        }
      } else {
        this.cur = null;
      }
      callback(this.cur);
    });
  },

  async login(email, pw) {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      const docSnap = await getDoc(doc(db, 'users', cred.user.uid));
      if (docSnap.exists()) {
        const userData = docSnap.data();
        // Sync Firestore email with Firebase Auth email if they differ
        if (cred.user.email && userData.email !== cred.user.email) {
          console.log('[Auth.login] Syncing email from Firebase Auth to Firestore:', cred.user.email);
          try {
            await updateDoc(doc(db, 'users', cred.user.uid), { email: cred.user.email });
            userData.email = cred.user.email;
          } catch (err) {
            console.error('[Auth.login] Error syncing email to Firestore:', err);
          }
        }
        this.cur = { id: cred.user.uid, ...userData };
        return this.cur;
      }
      return null;
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/invalid-credential') throw new Error('E-mail ou senha incorretos.');
      throw new Error('Falha ao fazer login: ' + e.message);
    }
  },

  async loginWithGoogle(barbeariaId = null) {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        this.cur = { id: user.uid, ...docSnap.data() };
        return this.cur;
      } else {
        const tId = barbeariaId || DB.getBarbeariaId();
        const userDoc = {
          name: user.displayName || 'Usuário',
          email: user.email,
          phone: user.phoneNumber || '',
          role: 'customer',
          barbeariaId: tId,
          points: 0,
          createdAt: new Date().toISOString().split('T')[0]
        };
        await setDoc(docRef, userDoc);
        this.cur = { id: user.uid, ...userDoc };
        return this.cur;
      }
    } catch (e) {
      console.error(e);
      throw new Error('Falha no login com Google: ' + e.message);
    }
  },

  async register({ name, email, phone, pw, role = 'customer', barbeariaId = null }) {
    try {
      // Usa tenant da URL para clientes
      const tId = barbeariaId || DB.getBarbeariaId();
      
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await updateProfile(cred.user, { displayName: name });
      
      const userDoc = {
        name: name.trim(),
        email: email.trim(),
        phone: phone || '',
        role,
        barbeariaId: tId,
        points: 0,
        createdAt: new Date().toISOString().split('T')[0]
      };
      
      await setDoc(doc(db, 'users', cred.user.uid), userDoc);
      this.cur = { id: cred.user.uid, ...userDoc };
      return this.cur;
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/email-already-in-use') throw new Error('Este e-mail já está cadastrado.');
      if (e.code === 'auth/weak-password') throw new Error('A senha deve ter pelo menos 6 caracteres.');
      throw new Error('Erro ao criar conta: ' + e.message);
    }
  },

  async logout() {
    await signOut(auth);
    this.cur = null;
  },

  isAdmin() {
    return this.cur?.role === 'admin';
  },
  isSuperAdmin() {
    return this.cur?.role === 'superadmin';
  },
  isBarber() {
    return this.cur?.role === 'barber';
  },
  ok() {
    return !!this.cur;
  }
};
