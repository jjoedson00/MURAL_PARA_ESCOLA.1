const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const db = new sqlite3.Database('./database.db');

// Configuração correta de caminhos para upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Middlewares - Ajustados com path.join para o Render encontrar o CSS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'chave-secreta-mural-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Criar Tabelas no Banco de Dados
db.serialize(() => {
    // O campo 'email' possui a regra UNIQUE para evitar duplicados
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
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        usuario_id INTEGER,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
});

// --- ROTAS DE AUTENTICAÇÃO ---

// Cadastro de Usuários (Professores) com validação de e-mail duplicado
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, token } = req.body;

    if (token !== 'COORDENACAO2026') {
        return res.status(403).json({ erro: 'Token de coordenação inválido!' });
    }

    try {
        const hashSenha = await bcrypt.hash(senha, 10);
        db.run(`INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)`, [nome, email, hashSenha], function(err) {
            if (err) {
                // Se o SQLite retornar erro de restrição UNIQUE do e-mail, responde com a mensagem limpa
                return res.status(400).json({ erro: 'Este endereço de e-mail já está cadastrado no sistema!' });
            }
            res.json({ sucesso: true });
        });
    } catch (e) {
        res.status(500).json({ erro: 'Erro interno no servidor.' });
    }
});

// Rota de Login modificada para responder com JSON em vez de travar o navegador
app.post('/api/login', (req, res) => {
    const { email, senha } = req.body;

    db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, usuario) => {
        if (err || !usuario) {
            return res.status(400).json({ erro: 'Usuário não encontrado.' });
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(400).json({ erro: 'Senha incorreta.' });
        }

        req.session.usuarioId = usuario.id;
        req.session.usuarioNome = usuario.nome;
        res.json({ sucesso: true });
    });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ sucesso: true });
});

app.get('/api/usuario', (req, res) => {
    if (req.session.usuarioId) {
        res.json({ logado: true, nome: req.session.usuarioNome });
    } else {
        res.json({ logado: false });
    }
});

// --- ROTAS DO MURAL ---

app.get('/api/avisos', (req, res) => {
    db.all(`SELECT avisos.*, usuarios.nome as autor FROM avisos 
            LEFT JOIN usuarios ON avisos.usuario_id = usuarios.id 
            ORDER BY data_criacao DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post('/api/avisos', upload.single('imagem'), (req, res) => {
    if (!req.session.usuarioId) {
        return res.status(401).json({ erro: 'Não autorizado.' });
    }

    const { titulo, conteudo } = req.body;
    const imagemPath = req.file ? `/uploads/${req.file.filename}` : null;

    db.run(`INSERT INTO avisos (titulo, conteudo, imagem, usuario_id) VALUES (?, ?, ?, ?)`,
        [titulo, conteudo, imagemPath, req.session.usuarioId], function(err) {
            if (err) return res.status(500).json({ erro: err.message });
            res.json({ sucesso: true });
        });
});

app.delete('/api/avisos/:id', (req, res) => {
    if (!req.session.usuarioId) {
        return res.status(401).json({ erro: 'Não autorizado.' });
    }

    const id = req.params.id;
    db.run(`DELETE FROM avisos WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ erro: err.message });
        res.json({ sucesso: true });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
