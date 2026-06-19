import { db, auth, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, sendPasswordResetEmail, updateEmail, updatePassword, deleteUser } from './firebase-config.js';

let currentBarbeariaId = null;

// Cache local temporário para a sessão para evitar milhares de reads no Firestore
// Em um app de produção com mais recursos, poderíamos usar onSnapshot.
let cache = {
  services: [],
  pros: [],
  apts: []
};

// Flags de controle de cache — evitam recarregar dados já carregados
let _cacheLoaded = {
  services: false,
  pros: false,
  apts: false
};

export const DB = {
  setBarbeariaId(id) {
    // Ao trocar de barbearia, invalida o cache anterior
    if (id !== currentBarbeariaId) {
      cache = { services: [], pros: [], apts: [] };
      _cacheLoaded = { services: false, pros: false, apts: false };
    }
    currentBarbeariaId = id;
  },
  getBarbeariaId() { return currentBarbeariaId; },

  /** Retorna true se os dados principais já foram carregados nesta sessão */
  hasCache(isAdmin = false) {
    if (isAdmin) {
      return _cacheLoaded.services && _cacheLoaded.pros && _cacheLoaded.apts;
    }
    return _cacheLoaded.services && _cacheLoaded.pros && _cacheLoaded.apts;
  },

  /** Invalida o cache forçando recarga na próxima navegação */
  invalidateCache(keys = null) {
    if (!keys) {
      _cacheLoaded = { services: false, pros: false, apts: false };
    } else {
      keys.forEach(k => { if (k in _cacheLoaded) _cacheLoaded[k] = false; });
    }
  },

  // ==============================
  // TENANTS (Barbearias)
  // ==============================
  async getBarbeariaBySlug(slug) {
    const q = query(collection(db, 'barbearias'), where('id', '==', slug));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { docId: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async getAllBarbearias() {
    const snap = await getDocs(collection(db, 'barbearias'));
    return snap.docs.map(d => ({ docId: d.id, ...d.data() }));
  },

  async createBarbearia(slug, name, donoId) {
    // Cria usando o próprio slug como docId para facilitar
    await setDoc(doc(db, 'barbearias', slug), {
      id: slug,
      name,
      donoId,
      status: 'active',
      createdAt: new Date().toISOString()
    });
  },

  async updateBarbeariaStatus(slug, status) {
    await updateDoc(doc(db, 'barbearias', slug), { status });
  },

  async deleteBarbearia(slug) {
    await deleteDoc(doc(db, 'barbearias', slug));
  },

  // Salva configuração PIX da barbearia
  async saveBarbeariaPixConfig(slug, pixConfig) {
    await updateDoc(doc(db, 'barbearias', slug), { pixConfig });
  },

  // Recarrega info da barbearia (para pegar pixConfig atualizado)
  async refreshTenantInfo(slug) {
    const q = query(collection(db, 'barbearias'), where('id', '==', slug));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { docId: snap.docs[0].id, ...snap.docs[0].data() };
  },

  // ==============================
  // SERVIÇOS
  // ==============================
  async loadServices() {
    if (!currentBarbeariaId) return [];
    const q = query(collection(db, 'services'), where('barbeariaId', '==', currentBarbeariaId));
    const snap = await getDocs(q);
    cache.services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cacheLoaded.services = true;
    return cache.services;
  },
  services() { return cache.services; },
  async saveService(data) {
    if (data.id) {
      const id = data.id;
      delete data.id;
      await updateDoc(doc(db, 'services', id), data);
    } else {
      await addDoc(collection(db, 'services'), { ...data, barbeariaId: currentBarbeariaId });
    }
    await this.loadServices();
  },
  async deleteService(id) {
    await deleteDoc(doc(db, 'services', id));
    await this.loadServices();
  },

  // ==============================
  // PROFISSIONAIS (Barbeiros)
  // ==============================
  async loadPros() {
    if (!currentBarbeariaId) return [];
    const q = query(collection(db, 'professionals'), where('barbeariaId', '==', currentBarbeariaId));
    const snap = await getDocs(q);
    cache.pros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cacheLoaded.pros = true;
    return cache.pros;
  },
  pros() { return cache.pros; },
  async savePro(data) {
    if (data.id) {
      const id = data.id;
      delete data.id;
      await updateDoc(doc(db, 'professionals', id), data);
    } else {
      await addDoc(collection(db, 'professionals'), { ...data, barbeariaId: currentBarbeariaId });
    }
    await this.loadPros();
  },
  async deletePro(id) {
    await deleteDoc(doc(db, 'professionals', id));
    await this.loadPros();
  },

  // ==============================
  // AGENDAMENTOS
  // ==============================
  async loadApts() {
    if (!currentBarbeariaId) return [];
    const q = query(collection(db, 'appointments'), where('barbeariaId', '==', currentBarbeariaId));
    const snap = await getDocs(q);
    cache.apts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cacheLoaded.apts = true;
    return cache.apts;
  },
  async loadUserApts(userId) {
    const q = query(collection(db, 'appointments'), where('userId', '==', userId));
    const snap = await getDocs(q);
    cache.apts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _cacheLoaded.apts = true;
    return cache.apts;
  },
  apts() { return cache.apts; },
  async addApt(apt) {
    await addDoc(collection(db, 'appointments'), { ...apt, barbeariaId: currentBarbeariaId });
    if (currentBarbeariaId) await this.loadApts();
  },
  // Retorna o DocumentReference (com .id) para uso no PIX txId
  async addAptAndReturn(apt) {
    const docRef = await addDoc(collection(db, 'appointments'), { ...apt, barbeariaId: currentBarbeariaId });
    if (currentBarbeariaId) await this.loadApts();
    else await this.loadUserApts(apt.userId);
    return docRef;
  },
  async updateAptStatus(id, status) {
    await updateDoc(doc(db, 'appointments', id), { status });
    const idx = cache.apts.findIndex(a => a.id === id);
    if (idx >= 0) cache.apts[idx].status = status;
  },

  // Atualiza status do pagamento PIX
  async updateAptPixStatus(id, pixStatus) {
    await updateDoc(doc(db, 'appointments', id), { pixStatus });
    const idx = cache.apts.findIndex(a => a.id === id);
    if (idx >= 0) cache.apts[idx].pixStatus = pixStatus;
  },
  async deleteApt(id) {
    await deleteDoc(doc(db, 'appointments', id));
    const idx = cache.apts.findIndex(a => a.id === id);
    if (idx >= 0) cache.apts.splice(idx, 1);
  },

  // ==============================
  // USUÁRIOS (Consulta para Admins)
  // ==============================
  async loadTenantUsers() {
    if (!currentBarbeariaId) return [];
    const q = query(collection(db, 'users'), where('barbeariaId', '==', currentBarbeariaId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  
  async updateUserPoints(uid, points) {
    await updateDoc(doc(db, 'users', uid), { points });
  },

  // ==============================
  // SUPER ADMIN — GESTÃO DO DONO
  // ==============================
  async getUserById(uid) {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },

  async updateUserProfile(uid, data) {
    // Atualiza campos permitidos no documento do usuário no Firestore
    await updateDoc(doc(db, 'users', uid), data);
  },

  async updateBarbeariaName(slug, name) {
    await updateDoc(doc(db, 'barbearias', slug), { name });
  },

  async updateBarbeariaData(slug, data) {
    await updateDoc(doc(db, 'barbearias', slug), data);
  },

  async sendOwnerPasswordReset(email) {
    await sendPasswordResetEmail(auth, email);
  },

  async createOwnerAuthUser(email, password) {
    // Cria um novo usuário no Firebase Auth com o email e senha fornecidos
    // Não deleta o usuário antigo (já que não temos a senha atual)
    // O usuário antigo ficará inativo mas existirá no Firebase Auth
    try {
      const newCredential = await createUserWithEmailAndPassword(auth, email, password);
      return newCredential.user.uid;
    } catch (error) {
      console.error('Erro ao criar usuário no Firebase Auth:', error);
      if (error.code === 'auth/email-already-in-use') {
        throw new Error('Este e-mail já está em uso no Firebase Auth.');
      }
      throw new Error('Erro ao criar usuário no Firebase Auth: ' + error.message);
    }
  },

  async recreateOwnerAuthWithTempEmail(originalEmail, password) {
    // Cria um novo usuário Firebase Auth usando um email temporário
    // Depois o dono pode fazer login com a senha original e o email será atualizado
    const tempEmail = `temp_${Date.now()}@${originalEmail.split('@')[1]}`;
    try {
      const newCredential = await createUserWithEmailAndPassword(auth, tempEmail, password);
      // Atualiza o email do usuário para o original
      await updateEmail(newCredential.user, originalEmail);
      return newCredential.user.uid;
    } catch (error) {
      console.error('Erro ao recriar usuário com email temporário:', error);
      throw new Error('Erro ao atualizar senha no Firebase Auth: ' + error.message);
    }
  },

  async updateOwnerPasswordDirectly(uid, newPassword) {
    // Atualiza a senha do dono diretamente no Firebase Auth
    // Isso requer que o super admin tenha as credenciais do dono
    // Como não temos Firebase Admin SDK, usamos uma abordagem alternativa:
    // Atualizamos apenas o Firestore e enviamos um email de reset
    await updateDoc(doc(db, 'users', uid), { 
      tempPassword: newPassword,
      passwordResetRequired: true
    });
  },

  async updateOwnerFirebaseEmail(uid, newEmail, currentPassword) {
    // Atualiza o email no Firebase Auth
    // Precisamos primeiro reautenticar o usuário com a senha atual
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Nenhum usuário autenticado');
      
      // Reautentica com a senha atual
      const credential = await signInWithEmailAndPassword(auth, user.email, currentPassword);
      
      // Atualiza o email
      await updateEmail(credential.user, newEmail);
      
      // Atualiza também no Firestore
      await updateDoc(doc(db, 'users', uid), { email: newEmail });
      
      return true;
    } catch (error) {
      console.error('Erro ao atualizar email no Firebase Auth:', error);
      throw new Error('Senha atual incorreta ou erro ao atualizar email. O dono deve fazer login e alterar o email no painel.');
    }
  },

  async updateOwnerFirebasePassword(uid, currentPassword, newPassword) {
    // Atualiza a senha no Firebase Auth
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Nenhum usuário autenticado');
      
      // Reautentica com a senha atual
      const credential = await signInWithEmailAndPassword(auth, user.email, currentPassword);
      
      // Atualiza a senha
      await updatePassword(credential.user, newPassword);
      
      return true;
    } catch (error) {
      console.error('Erro ao atualizar senha no Firebase Auth:', error);
      throw new Error('Senha atual incorreta ou erro ao atualizar senha.');
    }
  }
};
