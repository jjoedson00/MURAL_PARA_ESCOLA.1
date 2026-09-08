const { Pool } = require('pg');

// Substitua os valores abaixo com as informações do seu pgAdmin
const pool = new Pool({
    user: 'postgres',          // Seu usuário do Postgres (geralmente é 'postgres')
    host: 'localhost',         // Onde o banco está rodando (se for no seu PC, é localhost)
    database: 'nome_do_seu_banco', // O nome exato do banco que você criou no pgAdmin
    password: 'sua_senha_aqui',    // A senha que você definiu na instalação do Postgres
    port: 5432,                // Porta padrão do PostgreSQL
});

// Testa a conexão ao iniciar
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Erro ao conectar ao PostgreSQL:', err.stack);
    }
    console.log('Conexão com o PostgreSQL estabelecida com sucesso!');
    release();
});

module.exports = pool;
