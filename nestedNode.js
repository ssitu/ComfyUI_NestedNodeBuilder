import {app} from "../../scripts/app.js";

// Node that allows you to convert a set of nodes into a single node
export const nestedNodeType = "NestedNode";
export const nestedNodeTitle = "Nested Node";

export function serializeWorkflow(workflow) {
    let nodes = [];
    for (const id in workflow) {
        const node = workflow[id];
        nodes.push(LiteGraph.cloneObject(node.serialize()));
    }
    return nodes;
}

export class NestedNode {

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Node setup
        this.properties.serializedWorkflow = serializeWorkflow(workflow);
        this.placeNestedNode(workflow);
        this.resizeNestedNode(workflow);
        this.removeNestedNodes(workflow);
        console.log(this.serialize);
    }

    // Remove the nodes that are being nested
    removeNestedNodes(workflow) {
        for (const id in workflow) {
            const node = workflow[id];
            app.graph.remove(node);
        }
    }

    // Set the location of the nested node
    placeNestedNode(workflow) {
        // Find the average location of the nested nodes
        let x = 0;
        let y = 0;
        let count = 0;
        for (const id in workflow) {
            const node = workflow[id];
            x += node.pos[0];
            y += node.pos[1];
            count++;
        }
        x /= count;
        y /= count;

        // Set the location of the nested node
        this.pos = [x, y];
    }

    // Resize the nested node
    resizeNestedNode(workflow) {
        this.size = this.computeSize();
        this.size[0] *= 1.5;
    }

    // Apply the workflow during prompt execution
    applyToGraph(workflow) {
        console.log("applying serialized workflow to graph");
    }

    // Update node on property change
    onPropertyChanged(name, value) {
        if (name === "serializedWorkflow") {
            console.log("serializedWorkflow changed", value);
        }
    }

    updateSerializedWorkflow() {
        console.log("refreshing widgets");
        const workflow = this.properties.serializedWorkflow;
        for (const i in workflow) {
            const node = workflow[i];
            for (const j in node.widgets_values) {

            }
        }
    }

    onWidgetChanged(name, value, old_value, widget) {
        this.updateSerializedWorkflow();
    }

}
