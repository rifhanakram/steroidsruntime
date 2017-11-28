const http = require ("http");
const url = require("url");

function Server(){

    let serverObj;
    let nextFunc = ()=>{};
    let routes = {get:{},post:{},put:{},delete:{},patch:{},head:{}};

    function getBody(req, callback){
        let body = [];
        req.on('data', (chunk) => {
            body.push(chunk);
        })
        .on('end', () => {
            body = Buffer.concat(body).toString();

            try{
                let jsonBody = JSON.parse(body);
                callback(jsonBody);
            }catch (e){
                callback(body);
            }
        });
    }

    function getParams(req,parsedUrl, callback){
        let path = parsedUrl.path;
        let method = req.method;

        let mRoutes = routes[method.toLowerCase()];
        let handler;
        let variables;

        for (let route in mRoutes){
            let r = route.startsWith("/") ? route : ("/" + route);
            let mSplit = r.split("/");
            let rSplit = path.split("/");
            
            if (rSplit.length != mSplit.length)
                continue;

            let tmpVars = {};
            let isMatched = true;

            for (let i=0;i<rSplit.length;i++){
                let mPart = mSplit[i];
                let rPart = rSplit[i];

                if (mPart === "" && rPart==="")
                    continue;
                
                if (mPart.startsWith(":")){
                    tmpVars[mPart.substring(1)] = rPart;
                }else {
                    if (mPart.toLowerCase() != rPart.toLowerCase()){
                        isMatched = false;
                        break;
                    }
                }

            }

            if (isMatched){
                handler = mRoutes[route];
                variables = tmpVars;
            }
        }



        if (handler)
            callback(variables, handler);
        else
            callback();
    }

    function handler(req,res){
        let parsedUrl = url.parse(req.url,true);
        req.query = parsedUrl.query;

        getBody(req,(body)=>{
            req.body = body;
            getParams(req, parsedUrl, (params, handlerFunc)=>{
                if (handlerFunc){
                    res.send = function(statusCode, message, headers){
                        let res = this;
                        res.writeHead(statusCode, headers);
                        res.write(typeof message == "string" ? message : JSON.stringify(message));
                        res.end();
                    };

                    req.params = params;
                    handlerFunc(req,res,nextFunc);
                }else {
                    res.setHeader("Content-type", "application/json");
                    let bodyObj = { success:false, message:"No route handler found for : " + parsedUrl.path }
                    res.end(JSON.stringify(bodyObj));
                }
            });
        });
    }

    return {
        use: (plugin)=>{

        },
        listen:(portNumber, callback)=>{
            serverObj = http.createServer(handler);
            serverObj.listen(portNumber);
            callback({url:portNumber});
        },
        get: (route,handler)=> {
            routes.get[route] = handler;
        }, 
        post: (route,handler)=> {
            routes.post[route] = handler;
        }, 
        patch: (route,handler)=>{
            routes.patch[route] = handler;
        }, 
        delete: (route,handler)=> {
            routes.delete[route] = handler;
        }, 
        head: (route,handler)=> {
            routes.head[route] = handler;
        }
    }
}

module.exports = {
    createServer:()=>{
        return new Server();
    },
    acceptParser:()=>{},
    jsonp:()=>{},
    bodyParser:()=>{}
};

