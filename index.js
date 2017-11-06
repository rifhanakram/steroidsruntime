var path = require('path'); 
var fs = require('fs'); 


function FilterManager(){
    
    let filterChain = [];
    let currentIndex =-1;

    function processNext(filterObj, res, callback){
        currentIndex++;
        if (currentIndex == filterChain.length){
            callback(true, filterObj.chainData);
        }else {
            let currentItem = filterChain[currentIndex];
            currentItem(filterObj);
        }
    }

    function processFilter(req, res, next, chainData, callback){
        currentIndex = -1;

        let filterObj = {
            next: ()=>{
                processNext(filterObj, res, callback);
            },
            abort: (message, headers, statusCode)=>{
                let errorCode;
                let headerObj;
                if (headers || statusCode) {
                    errorCode = (statusCode ? statusCode : 500);
                    headerObj = (headers ? headers : {});
                }
              
                res.send(statusCode, message, headerObj);
                next();
                callback (false);
            },
            chainData: chainData,
            request: req
        }

        processNext(filterObj, res, callback);
    }

    return {
        register: (filterFunc)=>{
            filterChain.push(filterFunc);
        },
        process: processFilter
    }
}

function ExecutableUnit(params, filterManager){
    
    let currentContext = (()=>{
        /*
        let response = {
            statusCode: '400',
            body: JSON.stringify({ error: 'you messed up!' }),
            headers: {
                'Content-Type': 'application/json',
            }
        };*/

        var contextData = {headers:{"Content-Type": "application/json"}};
        var callbackFunc;
        return {
            succeed: (successJson) => {
                contextData = successJson;
                if (callbackFunc)
                    callbackFunc(successJson);
            },
            fail: (failJson) => {
                contextData = failJson;
                if (callbackFunc)
                    callbackFunc(failJson);
            },
            steroidsGetContext: () => {
                return contextData;
            },
            setCallback: (cb)=>{
                callbackFunc = cb;
            }
        }
    })();

    function dispatchToLambda(event,context,callback){
        
        let dotIndex = params.lambda.lastIndexOf(".");
        let handlerName = params.lambda.substring(dotIndex + 1);
        let lambdaFileName = params.lambda.substring(0,dotIndex);
        let fileName = lambdaFileName + ".js";

        let exists = fs.existsSync(fileName);
        if (exists) { 
            let lFunction = require("../../" + fileName);
            let callbackFunc = (error,result) => {
                if (!result){
                    if (error)
                        result = error;
                }

                callback(result);
            };
            context.setCallback(callbackFunc);
            let result = lFunction[handlerName](event,context,callbackFunc);
        } else {
            callback ({success: false, message: "Lambda function doesn't exist'"});
        }
    }

    return {
        handle : (req, res,next) => {

            filterManager.process(req,res,next,{},(success,result)=>{

                if (!success)
                    return;

                var eventObject = {
                    pathParameters: req.params,
                    httpMethod: req.method,
                    headers: req.headers,
                    body: req.body,
                    queryStringParameters:req.query ? req.query : {}
                };

                dispatchToLambda(eventObject,currentContext,(result) => {
                    let cObj = currentContext.steroidsGetContext();
                    let contentType = undefined;
                    if (cObj.headers){
                        if (cObj.statusCode !== undefined)
                            res.writeHead(parseInt(cObj.statusCode), cObj.headers);
                        else
                            res.writeHead(200,cObj.headers);

                        for (let hKey in cObj.headers){
                            let hVal = cObj.headers[hKey] === undefined ? undefined : cObj.headers[hKey].toLowerCase();
                            switch(hKey.toLowerCase()){
                                case "content-type":
                                    contentType = hVal;
                                    break;
                            }
                        }
                    }else {
                        if (cObj.statusCode !== undefined)
                            res.writeHead(parseInt(cObj.statusCode));
                        else
                            res.writeHead(200);
                    }
                    
                    if (!contentType)
                        contentType = "application/json";

                    if (contentType === "application/json"){
                        if (typeof result.body === "string")
                            res.write(result.body);
                        else
                            res.write(JSON.stringify(result.body));
                    }
                    else
                        res.write(result.body);
                        
                    res.end();
                    next();
                });

            });

        }
    }
}


function MsfCore(){
    let restify = require('restify');
    let filterManager = new FilterManager();
    let runtimeConfig = undefined;

    let routes = {get:{},post:{}};

    function setRoute(method, params, lambda){
        routes[method][params] =  lambda;
    }

    function startRoutingEngine(portNumber){
        let server = restify.createServer();
        
        server.use(restify.acceptParser(server.acceptable));
        server.use(restify.jsonp());
        server.use(restify.bodyParser());

        for (let mKey in routes)
        for (let mParam in routes[mKey]){
            let inObject = {
                lambda: routes[mKey][mParam],
                method: mKey
            };

            let eUnit = new ExecutableUnit(inObject, filterManager);
            let newPath;
            if (mParam.includes("{")){
                let splitData = mParam.split ("/");
                newPath = "";    
                for (let j=0;j<splitData.length;j++){
                    let fItem = splitData[j];
                    if (fItem.includes("{"))
                        fItem = ":" + (fItem.replace("{","").replace("}",""));
                    newPath += ("/" + fItem);
                }
            }else newPath = mParam;

            server[mKey](newPath, eUnit.handle);
        }
        
        server.use(restify.acceptParser(server.acceptable));
        server.use(restify.jsonp());
        server.use(restify.bodyParser({ mapParams: false }));
        server.listen(portNumber ? portNumber : 7777, () => {
            console.log('Steroids runtme is listening in', server.url);
        });
    }

    function isAllowed(endpointKey){
        let hasAccess = false;
        if (runtimeConfig){
            let endpointEffect = false;

            if (runtimeConfig.security)
                if (runtimeConfig.security.effect)
                    endpointEffect = runtimeConfig.security.effect == "allow" ? true : false;

            if (runtimeConfig.endpoints)
            if (runtimeConfig.endpoints[endpointKey])
            if (runtimeConfig.endpoints[endpointKey].effect)
                endpointEffect = runtimeConfig.endpoints[endpointKey].effect == "allow" ? true : false;

            if (endpointEffect)
                hasAccess = true;
            else
                hasAccess = false;

        }else hasAccess = true;
        
        return hasAccess;
    }

    function loadServerless(){
        let yaml = require('js-yaml');
        let fs   = require('fs');

        try {
            let ymlData = yaml.safeLoad(fs.readFileSync('serverless.yml', 'utf8'));
            
            if (ymlData)
            if (ymlData.functions){
                for(let funcKey in ymlData.functions){
                    if (isAllowed(funcKey)){
                        let funcObj = ymlData.functions[funcKey];
                        let lambdaPath = funcObj.handler;

                        for (let i=0;i<funcObj.events.length;i++){
                            let eObj  = funcObj.events[i];
                            
                            for (let eventKey in eObj){
                                if (eventKey === "http"){
                                    let eValue = eObj[eventKey];
                                    setRoute(eValue.method, eValue.path, lambdaPath);
                                }
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.log(e);
        }
    }

    function loadConfiguration(filename){
        let yaml = require('js-yaml');
        let fs   = require('fs');

        try {
            runtimeConfig = yaml.safeLoad(fs.readFileSync(filename, 'utf8'));
        }catch (e){
            console.log ("Error loading steroids runtime configuration!!! ", e);
        }
    }

    return {
        get: (params, lambda) => {
            setRoute("get", params, lambda);
        },
        post: (params, lambda) => {
            setRoute("post", params, lambda);
        },
        loadServerless: function(){
            loadServerless();
        },
        filter: (filterFunc)=>{
            filterManager.register(filterFunc);
        },
        loadConfiguration: loadConfiguration,
        start: startRoutingEngine
    }
}

process.on('uncaughtException', function (err) {
  console.log(err);
})

module.exports = new MsfCore();