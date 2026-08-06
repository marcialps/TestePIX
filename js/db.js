import { db, auth, collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc, query, where, sendPasswordResetEmail, writeBatch } from './firebase-config.js';

let currentBarbeariaId = null;

// Cache local temporário para a sessão para evitar milhares de reads no Firestore
// Em um app de produção com mais recursos, poderíamos usar onSnapshot.
let cache = {
  services: [],
  pros: [],
  apts: [],
  products: []
};

// Flags de controle de cache — evitam recarregar dados já carregados
let _cacheLoaded = {
  services: false,
  pros: false,
  apts: false,
  products: false
};

export const DB = {
  setBarbeariaId(id) {
    // Ao trocar de barbearia, invalida o cache anterior
    if (id !== currentBarbeariaId) {
      cache = { services: [], pros: [], apts: [], products: [] };
      _cacheLoaded = { services: false, pros: false, apts: false, products: false };
    }
    currentBarbeariaId = id;
  },
  getBarbeariaId() { return currentBarbeariaId; },

  /** Retorna true se os dados principais já foram carregados nesta sessão */
  hasCache(isAdmin = false) {
    if (isAdmin) {
      return _cacheLoaded.services && _cacheLoaded.pros && _cacheLoaded.apts && _cacheLoaded.products;
    }
    return _cacheLoaded.services && _cacheLoaded.pros && _cacheLoaded.apts && _cacheLoaded.products;
  },

  /** Invalida o cache forçando recarga na próxima navegação */
  invalidateCache(keys = null) {
    if (!keys) {
      _cacheLoaded = { services: false, pros: false, apts: false, products: false };
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
  // PRODUTOS (Loja)
  // ==============================
  async loadProducts() {
    if (!currentBarbeariaId) return [];
    try {
      const q = query(collection(db, 'products'), where('barbeariaId', '==', currentBarbeariaId));
      const snap = await getDocs(q);
      cache.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
      console.warn('[DB] Falha ao carregar produtos:', e);
      cache.products = [];
    }
    _cacheLoaded.products = true;
    return cache.products;
  },
  products() { return cache.products; },
  async saveProduct(data) {
    if (data.id) {
      const id = data.id;
      delete data.id;
      await updateDoc(doc(db, 'products', id), data);
    } else {
      await addDoc(collection(db, 'products'), { ...data, barbeariaId: currentBarbeariaId });
    }
    await this.loadProducts();
  },
  async deleteProduct(id) {
    await deleteDoc(doc(db, 'products', id));
    await this.loadProducts();
  },
  async updateProductStock(id, stock) {
    await updateDoc(doc(db, 'products', id), { stock });
    const idx = cache.products.findIndex(p => p.id === id);
    if (idx >= 0) cache.products[idx].stock = stock;
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

  // Conclui o agendamento aplicando desconto (percentual e/ou valor fixo)
  async completeApt(id, discountPct, discountVal) {
    const idx = cache.apts.findIndex(a => a.id === id);
    const apt = idx >= 0 ? cache.apts[idx] : null;
    const base = apt ? Number(apt.originalPrice || apt.price || 0) : 0;
    let finalPrice = base;
    if (discountPct > 0) finalPrice = base - (base * discountPct / 100);
    else if (discountVal > 0) finalPrice = base - discountVal;
    finalPrice = Math.round(Math.max(0, finalPrice) * 100) / 100;
    const discountAmount = Math.round(Math.max(0, base - finalPrice) * 100) / 100;
    const data = {
      status: 'concluido',
      originalPrice: base,
      discountPct: discountPct || 0,
      discount: discountAmount,
      price: finalPrice
    };
    await updateDoc(doc(db, 'appointments', id), data);
    if (idx >= 0) Object.assign(cache.apts[idx], data);
  },

  // Atualiza status do pagamento PIX
  async updateAptPixStatus(id, pixStatus) {
    await updateDoc(doc(db, 'appointments', id), { pixStatus });
    const idx = cache.apts.findIndex(a => a.id === id);
    if (idx >= 0) cache.apts[idx].pixStatus = pixStatus;
  },

  // Atualiza forma de pagamento (pix, credito, debito, dinheiro)
  async updateAptPayment(id, payMethod) {
    await updateDoc(doc(db, 'appointments', id), { payMethod });
    const idx = cache.apts.findIndex(a => a.id === id);
    if (idx >= 0) cache.apts[idx].payMethod = payMethod;
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

  // ==============================
  // CONCILIAÇÃO BANCÁRIA
  // ==============================
  async loadBankImports() {
    if (!currentBarbeariaId) return [];
    const q = query(collection(db, 'bankImports'), where('barbeariaId', '==', currentBarbeariaId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  },

  async loadBankTransactions() {
    if (!currentBarbeariaId) return [];
    const q = query(collection(db, 'bankTransactions'), where('barbeariaId', '==', currentBarbeariaId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async createBankImport(meta) {
    const ref = await addDoc(collection(db, 'bankImports'), {
      ...meta,
      barbeariaId: currentBarbeariaId,
      createdAt: new Date().toISOString()
    });
    return ref.id;
  },

  async addBankTransactions(txs) {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    txs.forEach(t => {
      const ref = doc(collection(db, 'bankTransactions'));
      batch.set(ref, { ...t, barbeariaId: currentBarbeariaId, createdAt: now });
    });
    await batch.commit();
  },

  async deleteBankImport(importId) {
    const q = query(collection(db, 'bankTransactions'), where('importId', '==', importId));
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await deleteDoc(doc(db, 'bankImports', importId));
  },

  async updateBankTransaction(id, patch) {
    await updateDoc(doc(db, 'bankTransactions', id), patch);
  },

  async deleteBankTransaction(id) {
    await deleteDoc(doc(db, 'bankTransactions', id));
  }
};
