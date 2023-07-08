sudo docker kill mynodered
sudo docker rm mynodered
sudo docker run -d -p 1880:1880 --name mynodered nodered/node-red
rm decthings-node-red-0.1.0.tgz
tsc
npm pack
sudo docker cp ./decthings-node-red-0.1.0.tgz mynodered:/decthings-node-red.tgz
sudo docker exec -ti mynodered bash -c "cd /data && npm remove @decthings/node-red && npm i /decthings-node-red.tgz"
sudo docker stop mynodered
sudo docker start mynodered
