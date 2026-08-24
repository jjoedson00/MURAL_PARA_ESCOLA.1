const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

// 🎯 COLOQUE A SUA CONEXÃO DO SUPABASE AQUI DENTRO DAS ASPAS:
const conexaoSupabase = "SUA_URI_DO_SUPABASE_AQUI";

const pool = new Pool({
    connectionString: conexaoSupabase,
    ssl: { rejectUnauthorized: false } // Necessário para conexões seguras em nuvem
});

// Configuração do Multer para Imagens
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'chave-secreta-mural-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Criar Tabelas Permanentes no Banco Postgres se não existirem
const inicializarBanco = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS avisos (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                conteudo TEXT NOT NULL,
                imagem TEXT,
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
            );
        `);
        console.log("Banco de dados permanente conectado com sucesso!");
    } catch (err) {
        console.error("Erro ao inicializar banco do Supabase:", err.message);
    }
};
inicializarBanco();

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, token } = req.body;

    if (token !== 'COORDENACAO2026') {
        return res.status(403).json({ erro: 'Token de coordenação inválido!' });
    }

    try {
        const hashSenha = await bcrypt.hash(senha, 10);
        await pool.query(
            `INSERT INTO usuarios (nome, email, senha) VALUES ($1, $2, $3)`,
            [nome, email, hashSenha]
        );
        res.json({ sucesso: true });
    } catch (e) {
        if (e.code === '23505') { // Código de erro do Postgres para campo UNIQUE duplicado
            return res.status(400).json({ erro: 'Este endereço de e-mail já está cadastrado no sistema!' });
        }
        res.status(500).json({ erro: 'Erro interno no servidor.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
        const resultado = await pool.query(`SELECT * FROM usuarios WHERE email = $1`, [email]);
        const usuario = resultado.rows[0];

        if (!usuario) {
            return res.status(400).json({ erro: 'Usuário não encontrado.' });
        }

        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(400).json({ erro: 'Senha incorreta.' });
        }

        req.session.usuarioId = usuario.id;
        req.session.usuarioNome = usuario.nome;
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: 'Erro no servidor durante o login.' });
    }
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

app.get('/api/avisos', async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT avisos.*, usuarios.nome as autor FROM avisos 
            LEFT JOIN usuarios ON avisos.usuario_id = usuarios.id 
            ORDER BY data_criacao DESC
        `);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.post('/api/avisos', upload.single('imagem'), async (req, res) => {
    if (!req.session.usuarioId) {
        return res.status(401).json({ erro: 'Não autorizado. Por favor, faça login.' });
    }

    const { titulo, conteudo } = req.body;
    const imagemPath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!titulo || !conteudo) {
        return res.status(400).json({ erro: 'Título e conteúdo são obrigatórios.' });
    }

    try {
        await pool.query(
            `INSERT INTO avisos (titulo, conteudo, imagem, usuario_id) VALUES ($1, $2, $3, $4)`,
            [titulo, conteudo, imagemPath, req.session.usuarioId]
        );
        return res.status(200).json({ sucesso: true });
    } catch (err) {
        return res.status(500).json({ erro: 'Erro ao salvar no banco permanente.' });
    }
});

app.delete('/api/avisos/:id', async (req, res) => {
    if (!req.session.usuarioId) {
        return res.status(401).json({ erro: 'Não autorizado.' });
    }

    const id = req.params.id;
    try {
        await pool.query(`DELETE FROM avisos WHERE id = $1`, [id]);
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor permanente rodando na porta ${PORT}`));
