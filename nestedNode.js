import {app} from "../../scripts/app.js";

// Node that allows you to convert a set of nodes into a single node
export const nodeName = "NestedNode";

class NestedNode {

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        this.properties.serializedWorkflow = this.serializeWorkflow(workflow);
        console.log(workflow)
        this.registerInputs(workflow);
        this.registerOutputs(workflow);
        this.removeNestedNodes(workflow);
        console.log(this);

        // Resize the node
        this.size = this.computeSize();
    }

    // How the workflow is stored
    serializeWorkflow(workflow) {
        let nodes = [];
        for (const i in workflow) {
            const node = workflow[i];
            nodes.push(node.serialize());
        }
        return nodes;
    }

    // Add inputs to the node
    registerInputs(workflow) {
        this.inputs = [];
        for (const i in workflow) {
            const node = workflow[i];
            const inputs = node.inputs;
            for (const i in inputs) {
                this.inputs.push(inputs[i]);
            }
        }
    }

    // Add outputs to the node
    registerOutputs(workflow) {
        this.outputs = [];
        for (const i in workflow) {
            const node = workflow[i];
            const outputs = node.outputs;
            for (const i in outputs) {
                this.outputs.push(outputs[i]);
            }
        }
    }

    // Remove the nodes that are being nested
    removeNestedNodes(workflow) {
        for (const i in workflow) {
            const node = workflow[i];
            app.graph.remove(node);
        }
    }

    // Apply the workflow during prompt execution
    applyToGraph(workflow) {

    }
}

// Register the extension
app.registerExtension({
    name: "SS.NestedNode",

    registerCustomNodes() {
        // Register the node
        LiteGraph.registerNodeType(nodeName, Object.assign(NestedNode, {
            title_mode: LiteGraph.NORMAL_TITLE, title: nodeName, collapsable: true,
        }));
    },
});
