import { auth, db, firebaseConfig, doc, getDoc, setDoc, updateDoc, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, googleProvider, signInWithPopup, verifyBeforeUpdateEmail, updatePassword, query, collection, where, getDocs } from './firebase-config.js';
import { DB } from './db.js';

// Helper functions for phone/email handling
const isPhoneNumber = (input) => {
  const cleaned = input.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15 && !input.includes('@');
};

const normalizePhone = (phone) => {
  return phone.replace(/\D/g, '');
};

const generateDummyEmail = (phone) => {
  const cleaned = normalizePhone(phone);
  return `${cleaned}@phone.barbearia.local`;
};

export const Auth = {
  cur: null,
  
  async init(callback) {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Busca documento do usuário no Firestore
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          this.cur = { id: user.uid, ...docSnap.data() };
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

  async login(emailOrPhone, pw) {
    try {
      let email = emailOrPhone;
      
      // If input looks like a phone number, find the user by phone
      if (isPhoneNumber(emailOrPhone)) {
        const cleanedPhone = normalizePhone(emailOrPhone);
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('phone', '==', cleanedPhone));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          throw new Error('Telefone não cadastrado.');
        }
        
        const userDoc = querySnapshot.docs[0].data();
        email = userDoc.email;
      }
      
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      const docSnap = await getDoc(doc(db, 'users', cred.user.uid));
      if (docSnap.exists()) {
        this.cur = { id: cred.user.uid, ...docSnap.data() };
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

  async register({ name, emailOrPhone, pw, role = 'customer', barbeariaId = null }) {
    try {
      // Usa tenant da URL para clientes
      const tId = barbeariaId || DB.getBarbeariaId();
      
      let email = emailOrPhone;
      let phone = '';
      
      // Check if input is a phone number
      if (isPhoneNumber(emailOrPhone)) {
        phone = normalizePhone(emailOrPhone);
        email = generateDummyEmail(phone);
        
        // Check if phone already exists
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('phone', '==', phone));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          throw new Error('Este telefone já está cadastrado.');
        }
      } else {
        // Input is email, check if email already exists
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', emailOrPhone.toLowerCase().trim()));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          throw new Error('Este e-mail já está cadastrado.');
        }
        email = emailOrPhone.toLowerCase().trim();
      }
      
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await updateProfile(cred.user, { displayName: name });
      
      const userDoc = {
        name: name.trim(),
        email: email,
        phone: phone,
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
      if (e.code === 'auth/invalid-email') throw new Error('E-mail inválido.');
      throw new Error('Erro ao criar conta: ' + e.message);
    }
  },

  // Cria um cliente pelo administrador sem trocar a sessão atual (via REST API)
  async registerByAdmin({ name, emailOrPhone, pw, role = 'customer' }) {
    const tId = DB.getBarbeariaId();
    if (!tId) throw new Error('Barbearia não identificada.');

    let email = emailOrPhone;
    let phone = '';

    if (isPhoneNumber(emailOrPhone)) {
      phone = normalizePhone(emailOrPhone);
      email = generateDummyEmail(phone);
      const q = query(collection(db, 'users'), where('phone', '==', phone));
      const s = await getDocs(q);
      if (!s.empty) throw new Error('Este telefone já está cadastrado.');
    } else {
      email = emailOrPhone.toLowerCase().trim();
      const q = query(collection(db, 'users'), where('email', '==', email));
      const s = await getDocs(q);
      if (!s.empty) throw new Error('Este e-mail já está cadastrado.');
    }

    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw, returnSecureToken: true })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.error?.message === 'EMAIL_EXISTS') throw new Error('Este e-mail já está cadastrado.');
      if (data.error?.message === 'WEAK_PASSWORD') throw new Error('A senha deve ter pelo menos 6 caracteres.');
      throw new Error('Erro ao criar cliente: ' + (data.error?.message || 'erro desconhecido'));
    }

    await setDoc(doc(db, 'users', data.localId), {
      name: name.trim(),
      email,
      phone,
      role,
      barbeariaId: tId,
      points: 0,
      createdAt: new Date().toISOString().split('T')[0]
    });

    return { id: data.localId, name: name.trim(), email, phone, role };
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
  },

  async updateCurrentUserEmail(newEmail) {
    try {
      if (!this.cur) throw new Error('Usuário não autenticado.');
      if (!auth.currentUser) throw new Error('Sessão Firebase inválida.');

      // Envia email de verificação para o novo email
      // O email só será atualizado quando o usuário clicar no link de verificação
      const actionCodeSettings = {
        url: window.location.href.split('#')[0] + '?b=' + (this.cur.barbeariaId || '') + '#admin-settings',
        handleCodeInApp: true
      };
      await verifyBeforeUpdateEmail(auth.currentUser, newEmail, actionCodeSettings);

      // Atualiza email no Firestore (antecipadamente)
      await updateDoc(doc(db, 'users', this.cur.id), { email: newEmail, pendingEmail: newEmail });

      // Atualiza cache local
      this.cur.email = newEmail;
      this.cur.pendingEmail = newEmail;

      return this.cur;
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/requires-recent-login') throw new Error('Por segurança, você precisa fazer login novamente antes de alterar seu e-mail.');
      if (e.code === 'auth/email-already-in-use') throw new Error('Este e-mail já está em uso por outra conta.');
      if (e.code === 'auth/invalid-email') throw new Error('E-mail inválido.');
      throw new Error('Erro ao atualizar e-mail: ' + e.message);
    }
  },

  async updateCurrentUserPassword(currentPassword, newPassword) {
    try {
      if (!this.cur) throw new Error('Usuário não autenticado.');
      if (!auth.currentUser) throw new Error('Sessão Firebase inválida.');
      if (!currentPassword || !newPassword) throw new Error('Senha atual e nova senha são obrigatórias.');
      if (newPassword.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');

      // Reautentica o usuário com a senha atual
      const credential = signInWithEmailAndPassword(auth, this.cur.email, currentPassword);
      const userCredential = await credential;

      // Atualiza a senha
      await updatePassword(userCredential.user, newPassword);

      return this.cur;
    } catch (e) {
      console.error(e);
      if (e.code === 'auth/wrong-password') throw new Error('Senha atual incorreta.');
      if (e.code === 'auth/weak-password') throw new Error('A nova senha é muito fraca. Use pelo menos 6 caracteres.');
      if (e.code === 'auth/requires-recent-login') throw new Error('Por segurança, você precisa fazer login novamente.');
      throw new Error('Erro ao atualizar senha: ' + e.message);
    }
  }
};
