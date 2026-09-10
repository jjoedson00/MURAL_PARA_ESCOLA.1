self.addEventListener('push',event=>{
    let dados={
        titulo:'Mural Digital',
        corpo:'Você recebeu um novo aviso.',
        url:'/mural.html'
    };

    try{
        if(event.data){
            dados={...dados,...event.data.json()};
        }
    }catch(erro){
        console.error('Erro ao ler notificação:',erro);
    }

    event.waitUntil(
        self.registration.showNotification(dados.titulo,{
            body:dados.corpo,
            icon:'/icon-192.png',
            badge:'/icon-192.png',
            data:{url:dados.url},
            vibrate:[200,100,200]
        })
    );
});

self.addEventListener('notificationclick',event=>{
    event.notification.close();

    const url=event.notification.data?.url||'/mural.html';

    event.waitUntil(
        clients.matchAll({
            type:'window',
            includeUncontrolled:true
        }).then(janelas=>{
            for(const janela of janelas){
                if('focus' in janela){
                    janela.navigate(url);
                    return janela.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});