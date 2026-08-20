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

let db;
(async () => {
    try {
        const SQL = await initSqlJs();
        
        if (fs.existsSync(DATABASE_PATH)) {
            const fileBuffer = fs.readFileSync(DATABASE_PATH);
            db = new SQL.Database(fileBuffer);
            console.log('📦 Banco de dados SQLite (sql.js) carregado com sucesso.');
        } else {
            db = new SQL.Database();
            console.log('📦 Novo banco de dados criado na memória.');
        }

        db.run(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
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

        // Conta master master padrão pronta
        const stmt = db.prepare('SELECT * FROM usuarios WHERE username = :user');
        const adminExiste = stmt.getAsObject({ ':user': 'admin' });
        stmt.free();

        if (!adminExiste.id) {
            const hash = await bcrypt.hash('admin123', 10);
            db.run('INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)', ['admin', 'admin@escola.com', hash]);
            salvarBancoNoDisco();
            console.log('🛡️ Conta master padrão pronta: admin / admin123');
        }
    } catch (err) {
        console.error("❌ Falha crítica ao iniciar o banco sql.js:", err);
    }
})();

function salvarBancoNoDisco() {
    try {
        if (db) {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(DATABASE_PATH, buffer);
        }
    } catch (err) {
        console.error("❌ Falha ao salvar arquivo no disco:", err);
    }
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

// ==================== ROTAS DA API ====================

app.post('/api/cadastro', async (req, res) => {
    const { username, email, password, chaveAcesso } = req.body;

    if (chaveAcesso !== 'COORDENACAO2026') {
        return res.status(403).json({ erro: 'Chave Administrativa inválida!' });
    }

    try {
        const stmtUser = db.prepare('SELECT * FROM usuarios WHERE username = :user');
        const userExiste = stmtUser.getAsObject({ ':user': username });
        stmtUser.free();
        if (userExiste.id) return res.status(400).json({ erro: 'Usuário já cadastrado.' });

        const stmtEmail = db.prepare('SELECT * FROM usuarios WHERE email = :email');
        const emailExiste = stmtEmail.getAsObject({ ':email': email });
        stmtEmail.free();
        if (emailExiste.id) return res.status(400).json({ erro: 'E-mail já cadastrado.' });

        const hash = await bcrypt.hash(password, 10);
        db.run('INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)', [username, email, hash]);
        salvarBancoNoDisco();
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: 'Erro no cadastro.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const stmt = db.prepare('SELECT * FROM usuarios WHERE username = :user OR email = :user');
        const usuario = stmt.getAsObject({ ':user': username });
        stmt.free();

        if (usuario.id && await bcrypt.compare(password, usuario.password)) {
            req.session.usuarioId = usuario.id;
            return res.json({ sucesso: true });
        }
        res.status(400).json({ erro: 'Usuário ou senha incorretos.' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro interno ao processar login.' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ sucesso: true });
});

app.get('/api/checar-sessao', (req, res) => {
    res.json({ logado: !!req.session.usuarioId });
});

app.get('/api/avisos', (req, res) => {
    try {
        const avisos = [];
        if (db) {
            const stmt = db.prepare('SELECT * FROM avisos ORDER BY data_criacao DESC');
            while(stmt.step()) {
                avisos.push(stmt.getAsObject());
            }
            stmt.free();
        }
        res.json(avisos);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.post('/api/avisos', requerAutenticacao, upload.single('imagem'), async (req, res) => {
    const { titulo, conteudo } = req.body;
    const imagem = req.file ? `/uploads/${req.file.filename}` : null;

    if (!titulo || !conteudo) return res.status(400).json({ erro: 'Campos obrigatórios ausentes.' });

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
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Mural online na porta ${PORT}`));
