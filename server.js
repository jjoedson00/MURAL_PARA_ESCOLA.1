const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('./database.db');

// Configuração do Multer para Upload de Imagens
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'chave-secreta-do-mural',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Criar Tabelas no Banco de Dados se não existirem
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS avisos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT,
        conteudo TEXT,
        imagem TEXT,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- ROTAS DE AUTENTICAÇÃO ---

// Cadastro de Usuário com Login Automático
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, token } = req.body;
    if (token !== 'coordenacao2026') {
        return res.status(400).json({ erro: 'Token secreto inválido! Apenas professores autorizados podem se cadastrar.' });
    }
    try {
        db.get(`SELECT id FROM usuarios WHERE email = ?`, [email], async (err, row) => {
            if (row) return res.status(400).json({ erro: 'Este e-mail já está cadastrado por outro professor.' });
            const hashedPassword = await bcrypt.hash(senha, 10);
            const query = `INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)`;
            db.run(query, [nome, email, hashedPassword], function(err) {
                if (err) return res.status(500).json({ erro: 'Erro ao salvar o cadastro.' });
                req.session.usuarioId = this.lastID;
                req.session.usuarioNome = nome;
                res.json({ sucesso: true });
            });
        });
    } catch {
        res.status(500).json({ erro: 'Erro no servidor.' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { email, senha } = req.body;
    const query = `SELECT * FROM usuarios WHERE email = ?`;
    db.get(query, [email], async (err, usuario) => {
        if (err || !usuario) return res.status(400).json({ erro: 'Usuário não encontrado.' });
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) return res.status(400).json({ erro: 'Senha incorreta.' });
        req.session.usuarioId = usuario.id;
        req.session.usuarioNome = usuario.nome;
        res.json({ sucesso: true });
    });
});

// Logout
app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ sucesso: true });
});

// Verificar usuário logado
app.get('/api/usuario-atual', (req, res) => {
    if (req.session.usuarioId) {
        res.json({ logado: true, nome: req.session.usuarioNome });
    } else {
        res.json({ logado: false });
    }
});

// --- ROTAS DOS AVISOS ---

// Listar todos os avisos
app.get('/api/avisos', (req, res) => {
    db.all(`SELECT * FROM avisos ORDER BY data_criacao DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

// Criar novo aviso
app.post('/api/avisos', upload.single('imagem'), (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ erro: 'Não autorizado.' });
    const { titulo, conteudo } = req.body;
    const imagemPath = req.file ? `/uploads/${req.file.filename}` : null;
    const query = `INSERT INTO avisos (titulo, conteudo, imagem) VALUES (?, ?, ?)`;
    db.run(query, [titulo, conteudo, imagemPath], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true, id: this.lastID });
    });
});

// Apagar um único aviso
app.delete('/api/avisos/:id', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ erro: 'Não autorizado.' });
    const id = req.params.id;
    db.get(`SELECT imagem FROM avisos WHERE id = ?`, [id], (err, row) => {
        if (row && row.imagem) {
            const fullPath = path.join(__dirname, 'public', row.imagem);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        db.run(`DELETE FROM avisos WHERE id = ?`, [id], function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ sucesso: true });
        });
    });
});

// --- NOVA ROTA: Apagar TODOS os avisos (Limpar Mural) ---
app.delete('/api/limpar-mural', (req, res) => {
    if (!req.session.usuarioId) return res.status(401).json({ erro: 'Não autorizado.' });
    
    // Apaga os arquivos físicos de imagem da pasta uploads
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
            fs.unlinkSync(path.join(uploadDir, file));
        }
    }

    // Apaga todos os registros do banco de dados
    db.run(`DELETE FROM avisos`, function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

// Porta do Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
