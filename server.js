import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const app = express();
const PORT = 3000;

// Garante a existência da pasta de upload para fotos de referência
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// Inicialização Assíncrona do Banco de Dados SQLite
const dbPromise = open({
    filename: './database.db',
    driver: sqlite3.Database
});

(async () => {
    const db = await dbPromise;
    
    // Tabela de Usuários (Professores e Administradores)
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

    // Criar um usuário administrador padrão de fábrica (User: admin / Pass: admin123)
    const adminExiste = await db.get('SELECT * FROM usuarios WHERE username = ?', ['admin']);
    if (!adminExiste) {
        const hash = await bcrypt.hash('admin123', 10);
        await db.run('INSERT INTO usuarios (username, password) VALUES (?, ?)', ['admin', hash]);
        console.log('🛡️ Conta master criada automaticamente: admin / admin123');
    }
})();

// Configurações Globais do Servidor Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'chave-secreta-mural-escolar-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Define como true se for rodar em HTTPS futuramente
}));

// Mapeamento de Pastas Estáticas do Front-End
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Mecanismo de Upload com Multer (Renomeia as imagens com a data atual para evitar substituições)
const storage = multer.diskStorage({
    destination: './uploads/',
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

// ==================== ROTAS DE AUTENTICAÇÃO E CADASTRO ====================

// Cadastro Seguro de Professores
app.post('/api/cadastro', async (req, res) => {
    const { username, password, chaveAcesso } = req.body;

    // Bloqueio rigoroso direto no servidor caso tentem burlar o Front-end
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
            return res.status(400).json({ erro: 'Este nome de usuário já está cadastrado por outro docente.' });
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

// ==================== ROTAS DE GERENCIAMENTO DOS AVISOS ====================

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
    
    // Remove o arquivo físico de imagem associado para não lotar o HD do servidor
    const aviso = await db.get('SELECT imagem FROM avisos WHERE id = ?', [id]);
    if (aviso && aviso.imagem) {
        const caminhoImagem = path.join('.', aviso.imagem);
        if (fs.existsSync(caminhoImagem)) fs.unlinkSync(caminhoImagem);
    }

    await db.run('DELETE FROM avisos WHERE id = ?', [id]);
    res.json({ sucesso: true });
});

app.listen(PORT, () => console.log(`🚀 Mural Digital Escolar online em: http://localhost:${PORT}`));
