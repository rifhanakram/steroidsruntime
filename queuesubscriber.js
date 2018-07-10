var Stomp = require('stomp-client');

module.exports = (function(){
    
    let _settings = {};
    let _stompClient;

    function connect(settings,callback){
        let {host,port,user,password,tls} = settings;
        _settings.host = host;
        _settings.port = port;
        
        if (tls)
            this._stompClient = new Stomp(host, port, user, password,"1.0", null,{},{});
        else
            this._stompClient = new Stomp(host, port, user, password);

        this._stompClient.on("error", function(err){
            console.log("STOMP ERROR : ", err);
        });
        
        this._stompClient.connect(function(sessionId){
            if (_settings.onConnect)
                _settings.onConnect(sessionId);
        });
    }

    function subscribe(queueName){
        this._stompClient.subscribe(queueName, function(body, headers){
            if (_settings.onMessage){
                
                try {
                    body = JSON.parse(body);
                }catch (e){

                }

                _settings.onMessage(body,headers);
            }
        });
        
        if (_settings.onSubscribed)
            _settings.onSubscribed(_settings.host + ":" + _settings.port + queueName);
    }

    return {
        connect: connect,
        subscribe: subscribe,
        onConnect: function(cb){
            _settings.onConnect = cb;
        },
        onSubscribed: function(cb){
            _settings.onSubscribed = cb;
        },
        onMessage: function(cb){
            _settings.onMessage = cb;
        }
    }
})();