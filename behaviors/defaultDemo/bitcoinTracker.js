class BitcoinTrackerActor {
    setup() {
        if (!this.history) {
            this.history = [{ date: 0, amount: 0 }];
        }
        this.scriptListen("BTC-USD", this.onBitcoinData);
        this.scriptListen("BTC-USD-history", this.onBitcoinHistory);
    }

    latest() {
        return this.history[this.history.length - 1];
    }

    onBitcoinData({date, amount}) {
        if (date - this.latest().date < 1000) return;
        this.addEntries({date, amount});
        this.sayDeck("value-changed", amount);
    }

    onBitcoinHistory(prices) {
        const newer = prices.filter(p => p.date - this.latest().date > 25000);
        this.addEntries(...newer);
        this.sayDeck("value-init", newer.map(v=>v.amount));
    }

    addEntries(...data) {
        this.history.push(...data);
        if (this.history[0].date === 0) {this.history.shift();}
        if (this.history.length > 300) {this.history.shift();}
    }
}
    
class BitcoinTrackerPawn {
    setup() {
        this.lastAmount = 0;
        this.listenDeck("value-changed", this.onBTCUSDChanged);

        this.onBTCUSDChanged();

        console.log("bitcoin pawn, setup");

        if (this.call("ElectedPawn", "isElected")) {
            console.log("elected in setup");
            this.handleElected();
        }

        this.scriptListen("handleElected", this.handleElected);
        this.scriptListen("handleUnelected", this.handleUnelected);
    }

    handleElected() {
        console.log("bitcoin elected");
        this.fetchHistory().then(() => this.openSocket());
    }

    handleUnelected() {
        console.log("bitcoin unelected");
        this.closeSocket();
    }

    openSocket() {
        this.closeSocket();

        const host = "wss://ws.sfox.com/ws";
        const sub_msg = {"type": "subscribe", "feeds": ["ticker.sfox.btcusd"]};

        this.socket = new WebSocket(host);

        this.socket.onopen = () => {
            this.socket.send(JSON.stringify(sub_msg));
        };

        this.socket.onmessage = (evt) => {
            let last;
            try {
                last = JSON.parse(evt.data).payload.last;
            } catch(e) {
                console.log("invalid data");
            }
            if (last !== undefined) {
                this.say("BTC-USD", { date: Date.now(), amount: +last });
            }
        }
    }

    closeSocket() {
        if (this.socket) {
            this.socket.close();
        }
    }

    latest() {
        return this.actor.call("BitcoinTrackerActor", "latest");
    }

    fetchHistory() {
        console.log("Fetching BTC-USD history from Coinbase...");
        return fetch(`https://api.coinbase.com/v2/prices/BTC-USD/historic?period=day`).then((response) => {
            return response.json();
        }).then((json) => {
            const prices = json.data.prices.map(price => ({ date: +new Date(price.time), amount: +price.price }));
            console.log("fetched %s prices", prices.length);
            const newer = prices.filter(price => price.date > this.latest().date).slice(0, 20);
            newer.sort((a, b) => a.date - b.date);
            console.log("publishing %s latest prices", newer.length);
            this.say("BTC-USD-history", newer);
        });
    }
    
    onBTCUSDChanged() {
        //console.log("changed");
        // this is called on all views, not just the elected one
        let amount = this.latest().amount;
        if(this.lastAmount === amount) return;
        let color = this.lastAmount > amount ? "#FF2222" : "#22FF22";
        this.lastAmount = amount;

        this.clear("#222222");
        let ctx = this.canvas.getContext('2d');
        ctx.textAlign = 'right';
        ctx.fillStyle = color;

        ctx.font = "40px Arial";
        ctx.fillText("BTC-USD", this.canvas.width - 40, 85);

        ctx.textAlign = 'center';
        ctx.font = "90px Arial";
        ctx.fillText("$" + amount.toFixed(2), this.canvas.width / 2, 100); //50+this.canvas.height/2);
        this.texture.needsUpdate = true;
        this.sayDeck('setColor', color);
    }

    clear(fill) {
        let ctx = this.canvas.getContext('2d');
        ctx.fillStyle = fill;
        ctx.fillRect( 0, 0, this.canvas.width, this.canvas.height );
    }
}

class BitLogoPawn {
    setup() {
        // this is a case where a method of the base object is called.
        this.scriptSubscribe(this.actor._parent.id, 'setColor', "setColor");
        this.removeEventListener("pointerWheel", "onPointerWheel");
    }
}

class BarGraphActor {
    setup() {
        if (this._cardData.values === undefined) {
            this._cardData.values = [];
            this._cardData.length = 20;
            this._cardData.height = 0.5;
        }
        this.scriptSubscribe(this._parent.id, "value-changed", this.updateBars);
        this.scriptSubscribe(this._parent.id, "value-init", this.initBars);
    }
    
    length() {
        return this._cardData.length;
    }

    height() {
        return this._cardData.height;
    }

    values() {
        return this._cardData.values;
    }

    updateBars(value, notSay) {
        let values = this._cardData.values;
        values.push(value);
        if (values.length > this.length()) {
            values.shift();
        }

        if (!notSay) {
            this.say('updateGraph');
        }
    }

    initBars(values) {
        values.forEach((value) => this.updateBars(value, true));
        this.say('updateGraph');
    }
}

class BarGraphPawn {
    setup() {
        this.constructBars();
        this.scriptListen('updateGraph', this.updateGraph);
        this.scriptSubscribe(this.actor._parent.id, 'setColor', this.setColor);
        this.updateGraph();
        this.removeEventListener("pointerWheel", "onPointerWheel");
    }

    constructBars() {
        this.shape.children.forEach((c) => {
            c.material.dispose();
        });
        this.shape.children = [];
        this.bars = [];
        let len = this.actor._cardData.length;
        let size = 1 / len;
        let THREE = Worldcore.THREE;
        let color = this.actor._cardData.color;
        this.base = new THREE.Mesh(
            new THREE.BoxGeometry(1, size / 4, size, 2, 4, 2 ),
            new THREE.MeshStandardMaterial());
        this.base.position.set(0, -size / 4, 0);        
        this.shape.add(this.base);
        this.bar = new THREE.Mesh(
            new THREE.BoxGeometry(size * 0.8, 1, size * 0.8, 2, 2, 2 ),
            new THREE.MeshStandardMaterial({color: color, emissive: color}));
        for(let i = 0; i < len; i++) {
            let bar = this.bar.clone();
            bar.material = bar.material.clone();
            bar.position.set((0.5 + i - len / 2) * size, 0,0);
            this.shape.add(bar);
            this.bars.push(bar);
        }
    }

    setColor(color) {
        let c = new Worldcore.THREE.Color(color);
        this.base.material.color = c;
        this.base.material.emissive = c;
    }

    updateGraph(){
        let values = this.actor._cardData.values;
        let height = this.actor._cardData.height;
        let mn = Math.min(...values);
        let mx = Math.max(...values);
        let range = mx - mn;
        mn = Math.max(mn - range / 10,0);
        range = mx - mn; //update this with the additional bit


        this.bars.forEach((b, i) => {
            let d = height * (values[i] - mn) / range;
            b.scale.set(1,d,1);
            b.position.y = d / 2;
        });
    }
}

export default {
    modules: [
        {
            name: "BitcoinTracker",
            actorBehaviors: [BitcoinTrackerActor],
            pawnBehaviors: [BitcoinTrackerPawn],
        },
        {
            name: "BarGraph",
            actorBehaviors: [BarGraphActor],
            pawnBehaviors: [BarGraphPawn],
        },
        {
            name: "BitLogo",
            pawnBehaviors: [BitLogoPawn]
        }
    ]
}

/* globals Worldcore */