const express=require('express');
const {Pool}=require('pg');
const path=require('path');
const multer=require('multer');
const session=require('express-session');
const webpush=require('web-push');
const fs=require('fs');
require('dotenv').config();

const app=express();
const port=process.env.PORT||3000;
const TOKEN_COORDENACAO=process.env.TOKEN_COORDENACAO;

const VAPID_PUBLIC_KEY=process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY=process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails(
    'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

const arquivoNotificacoes=path.join(__dirname,'notificacoes.json');

function lerNotificacoes(){
    try{
        if(!fs.existsSync(arquivoNotificacoes)){
            fs.writeFileSync(arquivoNotificacoes,'[]');
        }
        const dados=fs.readFileSync(arquivoNotificacoes,'utf8');
        return JSON.parse(dados||'[]');
    }catch(erro){
        console.error('Erro ao ler notificacoes.json:',erro);
        return [];
    }
}

function salvarNotificacoes(inscricoes){
    try{
        fs.writeFileSync(
            arquivoNotificacoes,
            JSON.stringify(inscricoes,null,2)
        );
    }catch(erro){
        console.error('Erro ao salvar notificacoes.json:',erro);
    }
}

async function enviarNotificacao(titulo){
    const inscricoes=lerNotificacoes();

    if(inscricoes.length===0)return;

    const payload=JSON.stringify({
        titulo:'📢 Novo aviso no Mural',
        corpo:titulo,
        url:'/mural.html'
    });

    const inscricoesValidas=[];

    for(const inscricao of inscricoes){
        try{
            await webpush.sendNotification(inscricao,payload);
            inscricoesValidas.push(inscricao);
        }catch(erro){
            console.error(
                'Erro ao enviar notificação:',
                erro.statusCode||erro.message
            );

            if(erro.statusCode!==404&&erro.statusCode!==410){
                inscricoesValidas.push(inscricao);
            }
        }
    }

    salvarNotificacoes(inscricoesValidas);
}

app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.use(session({
    secret:process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized:false,
    cookie:{
        httpOnly:true,
        secure:process.env.NODE_ENV==='production',
        sameSite:'lax',
        maxAge:1000*60*60*8
    }
}));

const storage=multer.diskStorage({
    destination:(req,file,cb)=>{
        cb(null,'public/uploads/');
    },
    filename:(req,file,cb)=>{
        const extensao=path.extname(file.originalname);
        const nomeUnico=Date.now()+'-'+Math.round(Math.random()*1E9)+extensao;
        cb(null,nomeUnico);
    }
});

const upload=multer({storage});

app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads',express.static(path.join(__dirname,'public','uploads')));

const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:{rejectUnauthorized:false}
});

function professorLogado(req,res,next){
    if(req.session&&req.session.professor){
        return next();
    }

    res.status(401).json({
        erro:'Você precisa estar logado como professor.'
    });
}

app.get('/',(req,res)=>{
    res.sendFile(path.join(__dirname,'public','index.html'));
});

app.get('/mural.html',(req,res)=>{
    res.sendFile(path.join(__dirname,'public','mural.html'));
});

app.get('/admin.html',(req,res)=>{
    res.sendFile(path.join(__dirname,'public','admin.html'));
});

app.get('/login.html',(req,res)=>{
    res.sendFile(path.join(__dirname,'public','login.html'));
});

app.get('/cadastro.html',(req,res)=>{
    res.sendFile(path.join(__dirname,'public','cadastro.html'));
});

app.post('/api/cadastro',async(req,res)=>{
    try{
        const {nome,email,senha,token}=req.body;

        if(!nome||!email||!senha||!token){
            return res.status(400).json({
                erro:'Preencha todos os campos.'
            });
        }

        if(token!==TOKEN_COORDENACAO){
            return res.status(403).json({
                erro:'Token da coordenação inválido.'
            });
        }

        const usuarioExistente=await pool.query(
            'SELECT id FROM usuarios WHERE email=$1',
            [email]
        );

        if(usuarioExistente.rows.length>0){
            return res.status(400).json({
                erro:'Este e-mail já está cadastrado.'
            });
        }

        const resultado=await pool.query(
            `INSERT INTO usuarios
            (nome,email,senha,tipo)
            VALUES($1,$2,$3,'professor')
            RETURNING id,nome,email,tipo`,
            [nome,email,senha]
        );

        req.session.professor=resultado.rows[0];

        req.session.save(erro=>{
            if(erro){
                console.error(erro);
                return res.status(500).json({
                    erro:'Erro ao criar sessão.'
                });
            }

            res.json({
                sucesso:true,
                mensagem:'Cadastro realizado com sucesso!'
            });
        });

    }catch(erro){
        console.error(erro);
        res.status(500).json({
            erro:'Erro ao cadastrar: '+erro.message
        });
    }
});

app.post('/api/login',async(req,res)=>{
    try{
        const {email,senha}=req.body;

        if(!email||!senha){
            return res.status(400).json({
                erro:'Preencha e-mail e senha.'
            });
        }

        const resultado=await pool.query(
            `SELECT id,nome,email,tipo
             FROM usuarios
             WHERE email=$1 AND senha=$2 AND tipo='professor'`,
            [email,senha]
        );

        if(resultado.rows.length===0){
            return res.status(401).json({
                erro:'E-mail ou senha incorretos.'
            });
        }

        req.session.professor=resultado.rows[0];

        req.session.save(erro=>{
            if(erro){
                console.error(erro);
                return res.status(500).json({
                    erro:'Erro ao iniciar sessão.'
                });
            }

            res.json({
                sucesso:true,
                mensagem:'Login realizado com sucesso!'
            });
        });

    }catch(erro){
        console.error(erro);
        res.status(500).json({
            erro:'Erro ao fazer login: '+erro.message
        });
    }
});

app.get('/api/sessao',(req,res)=>{
    if(req.session&&req.session.professor){
        return res.json({
            logado:true,
            professor:req.session.professor
        });
    }

    res.json({
        logado:false
    });
});

app.post('/api/logout',(req,res)=>{
    req.session.destroy(erro=>{
        if(erro){
            console.error(erro);
            return res.status(500).json({
                erro:'Erro ao sair.'
            });
        }

        res.clearCookie('connect.sid');

        res.json({
            sucesso:true,
            mensagem:'Sessão encerrada.'
        });
    });
});

app.get('/api/avisos',async(req,res)=>{
    try{
        const resultado=await pool.query(
            'SELECT * FROM avisos ORDER BY id DESC'
        );

        const avisos=resultado.rows.map(aviso=>({
            ...aviso,
            prioridade:aviso.cor_destaque||aviso.prioridade||'Normal',
            imagem:aviso.imagem||aviso.imagem_url||null,
            autor:aviso.autor||'Professor',
            data_criacao:aviso.data_criacao||aviso.data||null
        }));

        res.json(avisos);

    }catch(erro){
        console.error(erro);

        res.status(500).json({
            erro:'Erro ao carregar avisos.'
        });
    }
});

app.post(
    '/api/notificacoes/inscrever',
    (req,res)=>{
        try{
            const inscricao=req.body;

            if(!inscricao||!inscricao.endpoint){
                return res.status(400).json({
                    erro:'Inscrição de notificação inválida.'
                });
            }

            const inscricoes=lerNotificacoes();

            const existe=inscricoes.some(
                item=>item.endpoint===inscricao.endpoint
            );

            if(!existe){
                inscricoes.push(inscricao);
                salvarNotificacoes(inscricoes);
            }

            res.json({
                sucesso:true,
                mensagem:'Notificações ativadas.'
            });

        }catch(erro){
            console.error(erro);

            res.status(500).json({
                erro:'Erro ao registrar notificações.'
            });
        }
    }
);

app.get('/api/notificacoes/chave-publica',(req,res)=>{
    res.json({
        chavePublica:VAPID_PUBLIC_KEY
    });
});

app.post(
    '/api/avisos',
    professorLogado,
    upload.single('imagem'),
    async(req,res)=>{
        try{
            const titulo=String(req.body.titulo||'').trim();
            const conteudo=String(req.body.conteudo||'').trim();
            const prioridade=String(
                req.body.prioridade||'Normal'
            ).trim();

            const nomeImagem=req.file
                ? req.file.filename
                : null;

            if(!titulo||!conteudo){
                return res.status(400).json({
                    error:'Título e Conteúdo são obrigatórios!'
                });
            }

            const autor=req.session.professor.nome;

            console.log('PUBLICANDO AVISO:',{
                titulo,
                autor,
                professorLogado:req.session.professor
            });

            const queryTexto=`
                INSERT INTO avisos
                (titulo,conteudo,cor_destaque,imagem,autor,data_criacao)
                VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
                RETURNING *
            `;

            const resultado=await pool.query(
                queryTexto,
                [
                    titulo,
                    conteudo,
                    prioridade,
                    nomeImagem,
                    autor
                ]
            );

            console.log(
                'AVISO SALVO NO BANCO:',
                resultado.rows[0]
            );

            enviarNotificacao(titulo).catch(erro=>{
                console.error(
                    'Erro no sistema de notificações:',
                    erro
                );
            });

            res.status(201).json({
                sucesso:true,
                mensagem:'Aviso publicado por '+autor+'!'
            });

        }catch(erro){
            console.error(erro);

            res.status(500).json({
                error:'Erro ao salvar aviso: '+erro.message
            });
        }
    }
);

app.delete(
    '/api/avisos/:id',
    professorLogado,
    async(req,res)=>{
        try{
            const id=parseInt(req.params.id);

            if(isNaN(id)){
                return res.status(400).json({
                    erro:'ID do aviso inválido.'
                });
            }

            const autor=req.session.professor.nome;

            const resultado=await pool.query(
                `DELETE FROM avisos
                 WHERE id=$1 AND autor=$2
                 RETURNING *`,
                [id,autor]
            );

            if(resultado.rows.length===0){
                return res.status(404).json({
                    erro:'Aviso não encontrado ou não pertence a você.'
                });
            }

            res.json({
                sucesso:true,
                mensagem:'Aviso apagado com sucesso!'
            });

        }catch(erro){
            console.error(erro);

            res.status(500).json({
                erro:'Erro ao apagar aviso.'
            });
        }
    }
);

app.listen(port,'0.0.0.0',()=>{
    console.log(`🚀 Servidor Rodando na porta ${port}`);
});