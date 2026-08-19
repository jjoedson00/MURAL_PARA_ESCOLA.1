import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';

const app = express();

const IS_RENDER = process.env.RENDER === 'true';
const UPLOADS_DIR = IS_RENDER ? '/tmp/uploads' : './uploads';
const DATABASE_PATH = IS_RENDER ? '/tmp/database.db' : './database.db';

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Inicialização do Banco de Dados em JavaScript Puro (sql.js)
let db;
(async () => {
    const SQL = await initSqlJs();
    
    // Se o arquivo já existir, carrega ele, senão cria um banco novo na memória
    if (fs.existsSync(DATABASE_PATH)) {
        const fileBuffer = fs.readFileSync(DATABASE_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Criação das tabelas em formato nativo
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        );
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS avisos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT,
            conteudo TEXT,
            imagem TEXT,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Criar administrador padrão
    const stmt = db.prepare('SELECT * FROM usuarios WHERE username = :user');
    const adminExiste = stmt.getAsObject({ ':user': 'admin' });
    stmt.free();

    if (!adminExiste.id) {
        const hash = await bcrypt.hash('admin123', 10);
        db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', ['admin', hash]);
        salvarBancoNoDisco();
        console.log('🛡️ Conta master padrão pronta: admin / admin123');
    }
})();

// Função auxiliar para gravar as alterações da memória para o arquivo de texto do HD
function salvarBancoNoDisco() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DATABASE_PATH, buffer);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'chave-secreta-mural-escolar-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

const requerAutenticacao = (req, res, next) => {
    if (req.session.usuarioId) return next();
    res.status(401).json({ erro: 'Não autorizado. Faça o login primeiro.' });
};

// ==================== ROTAS ATUALIZADAS PARA SQL.JS ====================

app.post('/api/cadastro', async (req, res) => {
    const { username, password, chaveAcesso } = req.body;

    if (chaveAcesso !== 'COORDENACAO2026') {
        return res.status(403).json({ erro: 'Código de autorização inválido. Cadastro negado.' });
    }

    try {
        const stmt = db.prepare('SELECT * FROM usuarios WHERE username = :user');
        const usuarioExiste = stmt.getAsObject({ ':user': username });
        stmt.free();
        
        if (usuarioExiste.id) {
            return res.status(400).json({ erro: 'Este nome de usuário já está em uso.' });
        }

        const hash = await bcrypt.hash(password, 10);
        db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', [username, hash]);
        salvarBancoNoDisco();
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: 'Falha interna ao registrar docente.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const stmt = db.prepare('SELECT * FROM usuarios WHERE username = :user');
    const usuario = stmt.getAsObject({ ':user': username });
    stmt.free();

    if (usuario.id && await bcrypt.compare(password, usuario.password)) {
        req.session.usuarioId = usuario.id;
        return res.json({ sucesso: true });
    }
    res.status(400).json({ erro: 'Usuário ou senha incorretos.' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ sucesso: true });
});

app.get('/api/checar-sessao', (req, res) => {
    res.json({ logado: !!req.session.usuarioId });
});

app.get('/api/avisos', (req, res) => {
    const avisos = [];
    const stmt = db.prepare('SELECT * FROM avisos ORDER BY data_criacao DESC');
    while(stmt.step()) {
        avisos.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(avisos);
});

app.post('/api/avisos', requerAutenticacao, upload.single('imagem'), async (req, res) => {
    const { titulo, conteudo } = req.body;
    const imagem = req.file ? `/uploads/${req.file.filename}` : null;

    if (!titulo || !conteudo) {
        return res.status(400).json({ erro: 'O aviso precisa conter um título e uma descrição.' });
    }

    db.run('INSERT INTO avisos (titulo, conteudo, imagem) VALUES (?, ?, ?)', [titulo, conteudo, imagem]);
    salvarBancoNoDisco();
    res.json({ sucesso: true });
});

app.delete('/api/avisos/:id', requerAutenticacao, async (req, res) => {
    const { id } = req.params;
    
    const stmt = db.prepare('SELECT imagem FROM avisos WHERE id = :id');
    const aviso = stmt.getAsObject({ ':id': id });
    stmt.free();

    if (aviso && aviso.imagem) {
        const nomeArquivo = path.basename(aviso.imagem);
        const caminhoImagem = path.join(UPLOADS_DIR, nomeArquivo);
        if (fs.existsSync(caminhoImagem)) fs.unlinkSync(caminhoImagem);
    }

    db.run('DELETE FROM avisos WHERE id = ?', [id]);
    salvarBancoNoDisco();
    res.json({ sucesso: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sistema do Mural online puramente em JS na porta ${PORT}`);
});
