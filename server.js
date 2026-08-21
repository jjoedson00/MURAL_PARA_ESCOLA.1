import express from 'express';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// CONEXÃO COM O BANCO DE DADOS (PostgreSQL do Render)
const DB_URL = process.env.DATABASE_URL;

const pool = new pg.Pool({
    connectionString: DB_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Inicialização automática das tabelas no Render
const inicializarBanco = async () => {
    try {
        if (!DB_URL) {
            console.error('AVISO: A variável DATABASE_URL não foi configurada no painel do Render.');
            return;
        }
        
        // 1. Tabela de usuários para Login e Cadastro
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                senha TEXT NOT NULL
            )
        `);

        // 2. Tabela de avisos para alimentar o Mural da tela azul
        await pool.query(`
            CREATE TABLE IF NOT EXISTS avisos (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                conteudo TEXT NOT NULL,
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('Banco de dados PostgreSQL conectado e tabelas prontas.');
    } catch (err) {
        console.error('Erro ao inicializar tabelas no banco:', err.message);
    }
};
inicializarBanco();

// ROTAS DE LOGIN E CADASTRO
app.post('/auth/cadastro', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos.' });

    try {
        await pool.query('INSERT INTO usuarios (email, senha) VALUES ($1, $2)', [email, senha]);
        res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ erro: 'Este e-mail já está cadastrado.' });
        res.status(500).json({ erro: 'Erro interno ao salvar administrador.' });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Preencha todos os campos.' });

    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND senha = $2', [email, senha]);
        if (result.rows.length > 0) {
            res.json({ autenticado: true, usuario: result.rows[0].email });
        } else {
            res.status(401).json({ autenticado: false, erro: 'E-mail ou senha incorretos.' });
        }
    } catch (err) {
        res.status(500).json({ erro: 'Erro interno na validação de login.' });
    }
});

// ROTAS DO MURAL DE AVISOS
app.get('/api/avisos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM avisos ORDER BY data_criacao DESC');
        res.json(result.rows);
    } catch (err) {
        console.error("Erro na rota GET /api/avisos:", err.message);
        res.status(500).json({ erro: 'Erro ao buscar os avisos do mural.' });
    }
});

app.post('/api/avisos', async (req, res) => {
    const { titulo, conteudo } = req.body;
    if (!titulo || !conteudo) return res.status(400).json({ erro: 'Preencha título e conteúdo.' });

    try {
        await pool.query('INSERT INTO avisos (titulo, conteudo) VALUES ($1, $2)', [titulo, conteudo]);
        res.status(201).json({ mensagem: 'Aviso publicado com sucesso!' });
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao publicar no banco.' });
    }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
