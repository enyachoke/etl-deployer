

const k8s = require('@kubernetes/client-node');
const Promise = require("bluebird");
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

'use strict';

const Hapi = require('@hapi/hapi');

const init = async () => {

    const server = Hapi.server({
        port: 3000,
        host: '0.0.0.0'
    });

    server.route({
        method: 'GET',
        path: '/',
        handler: (request, h) => {
            return Promise.all([createDeployment('default', request.query.branch, request.query.git_hash),
            createService('default', request.query.branch, request.query.git_hash),
            createIngress('default', request.query.branch, request.query.git_hash)]);
        }
    });

    await server.start();
    console.log('Server running on %ss', server.info.uri);
};

process.on('unhandledRejection', (err) => {

    console.log(err);
    process.exit(1);
});

init();


function createService(namespace, branchName, githash) {
    const service = {
        kind: "Service",
        apiVersion: "v1",
        metadata: {
            name: `etlrestservice${branchName.toLowerCase()}`,
            namespace: "default"
        },
        spec: {
            ports: [
                {
                    "protocol": "TCP",
                    "port": 8002,
                    "targetPort": 8002
                }
            ],
            selector: {
                "io.kompose.service": `etlrestservices${branchName.toLowerCase()}`
            }
        },
        status: {
            "loadBalancer": {}
        }
    };
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    return k8sApi.createNamespacedService(namespace, service).then(
        (response) => {
            console.log('Created Service');
            return ({ service: 'created ok' });
        },
        (err) => {
            if (err.response.statusCode === 409) {
                console.log('Service Exists patching==>');
                const headers = { 'content-type': 'application/strategic-merge-patch+json' }
                return k8sApi.patchNamespacedService(service.metadata.name, namespace, service, undefined, undefined, { headers }).then((response) => {
                    // console.log('Service Patched',response.response);
                    // delete .response.request
                    return { service: 'patching ok' };
                }, (err) => {
                    console.log('Error Patching Service' + JSON.stringify(err));
                    return { error: 'An error occured patching' };
                });

            } else {
                return { error: 'An error occured creating service' };
            }
        },
    )
}

function createIngress(namespace, branchName, githash) {
    const k8sApi = kc.makeApiClient(k8s.ExtensionsV1beta1Api);
    const ingress = {
        "kind": "Ingress",
        "apiVersion": "extensions/v1beta1",
        "metadata": {
            "name": `etl-ingress${branchName.toLowerCase()}`,
            "namespace": "default",
            "annotations": {
                "ingress.kubernetes.io/rewrite-target": "/",
            }
        },
        "spec": {
            "rules": [
                {
                    "http": {
                        "paths": [
                            {
                                "path": `/${branchName.toLowerCase()}(/|$)(.*)`,
                                "backend": {
                                    "serviceName": `etlrestservice${branchName.toLowerCase()}`,
                                    "servicePort": 8002
                                }
                            }
                        ]
                    }
                }
            ]
        },
        "status": {
            "loadBalancer": {
                "ingress": [
                    {}
                ]
            }
        }
    };
    return k8sApi.createNamespacedIngress(namespace, ingress).then(
        (response) => {
            console.log('Created ingress');
            // console.log(response);
            // k8sApi.readNamespace(namespace.metadata.name).then((response) => {
            //     console.log(response);
            //     k8sApi.deleteNamespace(namespace.metadata.name, {} /* delete options */);
            // });
            return { ingress: 'create ok' };;
        },
        (err) => {
            if (err.response.statusCode === 409) {
                console.log('Ingress Exists patching==>');
                const headers = { 'content-type': 'application/strategic-merge-patch+json' }
                return k8sApi.patchNamespacedIngress(ingress.metadata.name, namespace, ingress, undefined, undefined, { headers }).then((response) => {
                    console.log('Ingress Patched');
                    return { ingress: 'patch ok' };;
                }, (err) => {
                    console.log('Error Patching Ingress' + JSON.stringify(err));
                    return { error: 'Error patching ingress' };
                });

            } else {
                return { error: 'Error creating ingress' };;
            }
        },
    );
}



function createDeployment(namespace, branchName, githash) {
    const k8sApi = kc.makeApiClient(k8s.ExtensionsV1beta1Api);
    const deployment = {
        "kind": "Deployment",
        "apiVersion": "extensions/v1beta1",
        "metadata": {
            "name": `etlrestservices${branchName.toLowerCase()}`,
            "labels": {
                "io.kompose.service": `etlrestservices${branchName.toLowerCase()}`
            },
            "annotations": {
                "deployment.kubernetes.io/revision": "1",
                "kompose.cmd": "kompose convert",
                "kompose.version": "1.18.0 ()"
            }
        },
        "spec": {
            "replicas": 1,
            "selector": {
                "matchLabels": {
                    "io.kompose.service": `etlrestservices${branchName.toLowerCase()}`
                }
            },
            "template": {
                "metadata": {
                    "creationTimestamp": null,
                    "labels": {
                        "io.kompose.service": `etlrestservices${branchName.toLowerCase()}`,
                        "githash": githash
                    }
                },
                "spec": {
                    "volumes": [
                        {
                            "name": "config-volume",
                            "configMap": {
                                "name": "etl-config"
                            }
                        },
                        {
                            "name": "etl-uploads-claim",
                            "persistentVolumeClaim": {
                                "claimName": "etl-uploads-claim"
                            }
                        }
                    ],
                    "containers": [
                        {
                            "name": `etlrestservices${branchName.toLowerCase()}`,
                            "image": `enyachoke/etl-services:${branchName}`,
                            "ports": [
                                {
                                    "containerPort": 8002,
                                    "protocol": "TCP"
                                }
                            ],
                            "env": [
                                {
                                    "name": "TZ",
                                    "value": "Africa/Nairobi"
                                }
                            ],
                            "volumeMounts": [
                                {
                                    "name": "config-volume",
                                    "mountPath": "/opt/etl/conf"
                                },
                                {
                                    "name": "etl-uploads-claim",
                                    "mountPath": "/opt/etl/uploads"
                                }
                            ],
                            "imagePullPolicy": "Always"
                        }
                    ],
                    "restartPolicy": "Always"
                }
            }
        }
    };

    return k8sApi.createNamespacedDeployment(namespace, deployment).then(
        (response) => {
            console.log('Created deployment');
            // console.log(response);
            // k8sApi.readNamespace(namespace.metadata.name).then((response) => {
            //     console.log(response);
            //     k8sApi.deleteNamespace(namespace.metadata.name, {} /* delete options */);
            // });
            return { deployment: 'create ok' };;
        },
        (err) => {
            if (err.response.statusCode === 409) {
                console.log('Deployment Exists patching==>');
                const headers = { 'content-type': 'application/strategic-merge-patch+json' }
                return k8sApi.patchNamespacedDeployment(deployment.metadata.name, namespace, deployment, undefined, undefined, { headers }).then((response) => {
                    console.log('Deployment Patched');
                    return { deployment: 'patching ok' };;
                }, (err) => {
                    console.log('Error Patching Deployment' + JSON.stringify(err));
                    return { error: 'Error patching deployment' };
                });

            } else {
                return { error: 'Error creating ingress' };
            }
        },
    );
}