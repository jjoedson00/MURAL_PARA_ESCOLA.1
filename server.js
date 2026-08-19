import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const app = express();

// CONFIGURAÇÃO DE PASTAS DE ACORDO COM O AMBIENTE (Local vs Render)
// Na nuvem (Render), usamos a pasta /tmp que permite escrita de arquivos
const IS_RENDER = process.env.RENDER === 'true';
const UPLOADS_DIR = IS_RENDER ? '/tmp/uploads' : './uploads';
const DATABASE_PATH = IS_RENDER ? '/tmp/database.db' : './database.db';

// Garante que a pasta de uploads exista no local correto
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Inicialização do Banco de Dados SQLite no caminho seguro
const dbPromise = open({
    filename: DATABASE_PATH,
    driver: sqlite3.Database
});

(async () => {
    const db = await dbPromise;
    
    // Tabela de Usuários (Professores)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);
    
    // Tabela de Avisos Escolares
    await db.exec(`
        CREATE TABLE IF NOT EXISTS avisos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT,
            conteudo TEXT,
            imagem TEXT,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Criar um usuário administrador padrão automático (User: admin / Pass: admin123)
    const adminExiste = await db.get('SELECT * FROM usuarios WHERE username = ?', ['admin']);
    if (!adminExiste) {
        const hash = await bcrypt.hash('admin123', 10);
        await db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', ['admin', hash]);
        console.log('🛡️ Conta master padrão pronta: admin / admin123');
    }
})();

// Configurações do Servidor Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'chave-secreta-mural-escolar-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Servir arquivos estáticos do Front-end
app.use(express.static('public'));

// Rota para entregar as imagens salvas (independente de onde estejam guardadas)
app.use('/uploads', express.static(UPLOADS_DIR));

// Configuração do Multer para upload de imagens de referência
const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Bloqueador de Segurança (Middleware)
const requerAutenticacao = (req, res, next) => {
    if (req.session.usuarioId) return next();
    res.status(401).json({ erro: 'Não autorizado. Faça o login primeiro.' });
};

// ==================== ROTAS DO SISTEMA ====================

// Cadastro Seguro de Professores (Chave Secreta)
app.post('/api/cadastro', async (req, res) => {
    const { username, password, chaveAcesso } = req.body;

    if (chaveAcesso !== 'COORDENACAO2026') {
        return res.status(403).json({ erro: 'Código de autorização inválido. Cadastro negado.' });
    }

    if (!username || !password) {
        return res.status(400).json({ erro: 'Todos os campos de login devem ser preenchidos.' });
    }

    try {
        const db = await dbPromise;
        const usuarioExiste = await db.get('SELECT * FROM usuarios WHERE username = ?', [username]);
        
        if (usuarioExiste) {
            return res.status(400).json({ erro: 'Este nome de usuário já está em uso.' });
        }

        const hash = await bcrypt.hash(password, 10);
        await db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', [username, hash]);
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: 'Falha interna ao registrar no banco de dados.' });
    }
});

// Login do Painel Administrativo
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const db = await dbPromise;
    const usuario = await db.get('SELECT * FROM usuarios WHERE username = ?', [username]);

    if (usuario && await bcrypt.compare(password, usuario.password)) {
        req.session.usuarioId = usuario.id;
        return res.json({ sucesso: true });
    }
    res.status(400).json({ erro: 'Usuário ou senha incorretos.' });
});

// Logoff da Sessão
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ sucesso: true });
});

// Validador de Sessão Ativa
app.get('/api/checar-sessao', (req, res) => {
    res.json({ logado: !!req.session.usuarioId });
});

// Listagem de Avisos (Acesso público no mural)
app.get('/api/avisos', async (req, res) => {
    const db = await dbPromise;
    const avisos = await db.all('SELECT * FROM avisos ORDER BY data_criacao DESC');
    res.json(avisos);
});

// Criar Novo Comunicado (Protegido por Login)
app.post('/api/avisos', requerAutenticacao, upload.single('imagem'), async (req, res) => {
    const { titulo, conteudo } = req.body;
    const imagem = req.file ? `/uploads/${req.file.filename}` : null;

    if (!titulo || !conteudo) {
        return res.status(400).json({ erro: 'O aviso precisa conter um título e uma descrição.' });
    }

    const db = await dbPromise;
    await db.run('INSERT INTO avisos (titulo, conteudo, imagem) VALUES (?, ?, ?)', [titulo, conteudo, imagem]);
    res.json({ sucesso: true });
});

// Remover Comunicado (Protegido por Login)
app.delete('/api/avisos/:id', requerAutenticacao, async (req, res) => {
    const { id } = req.params;
    const db = await dbPromise;
    
    const aviso = await db.get('SELECT imagem FROM avisos WHERE id = ?', [id]);
    if (aviso && aviso.imagem) {
        const nomeArquivo = path.basename(aviso.imagem);
        const caminhoImagem = path.join(UPLOADS_DIR, nomeArquivo);
        if (fs.existsSync(caminhoImagem)) fs.unlinkSync(caminhoImagem);
    }

    await db.run('DELETE FROM avisos WHERE id = ?', [id]);
    res.json({ sucesso: true });
});

// Inicialização de porta dinâmica para o Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sistema do Mural online na porta ${PORT}`);
});
