export class Queue {
    // Basic queue implementation for now

    constructor(init_items=[]) {
        this._queue = init_items;
    }

    enqueue(item) {
        this._queue.push(item);
    }

    dequeue() {
        return this._queue.shift();
    }

    peek() {
        return this._queue[0];
    }

    get length() {
        return this._queue.length;
    }

}