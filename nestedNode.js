import {app} from "../../scripts/app.js";
import {ComfyWidgets} from "../../scripts/widgets.js";
import {ext} from "./nodeMenu.js";

// Node that allows you to convert a set of nodes into a single node
export const nestedNodeType = "NestedNode";
export const nestedNodeTitle = "Nested Node";

export class NestedNode {

    widgetsToSerializedWidgets = {};

    // Nest the workflow within this node
    nestWorkflow(workflow) {
        // Add this node to the graph
        app.graph.add(this);

        // Node setup
        this.properties.serializedWorkflow = this.serializeWorkflow(workflow);
        console.log("Workflow being nested:", workflow);
        this.inheritInputs(workflow);
        this.inheritOutputs(workflow);
        this.inheritWidgets();
        this.placeNestedNode(workflow);
        this.resizeNestedNode(workflow);
        this.removeNestedNodes(workflow);
        console.log("The resulting nested node:", this);

    }

    refreshNest() {
        this.inheritWidgets();
    }

    // How the workflow is stored
    serializeWorkflow(workflow) {
        let nodes = [];
        for (const id in workflow) {
            const node = workflow[id];
            nodes.push(node.serialize());
        }
        return nodes;
    }

    // Add inputs to the node
    inheritInputs(workflow) {
        this.inputs = [];
        let nested_slot = -1;

        // Iterate over each node in the workflow
        for (const id in workflow) {
            const node = workflow[id];
            // Iterate over each input in the node
            for (const slot in node.inputs) {
                // Check if the input is connected by another node in the workflow
                const inputNode = node.getInputNode(slot);
                if (Object.values(workflow).includes(inputNode)) {
                    // If so, skip this input
                    continue;
                }
                // Otherwise, add the input to the node
                const inputInfo = node.getInputInfo(slot);
                this.addInput(inputInfo.name, inputInfo.type);
                nested_slot++;
                // Add the connection to the input if it exists
                const link = node.getInputLink(slot);
                if (link) {
                    inputNode.connect(link.origin_slot, this, nested_slot);
                }
            }
        }
    }

    // Add outputs to the node
    inheritOutputs(workflow) {
        this.outputs = [];
        let nested_slot = -1;

        // Iterate over each node in the workflow
        for (const id in workflow) {
            const node = workflow[id];
            // Iterate over each output in the node
            for (const slot in node.outputs) {
                // Check if the output only goes to other nodes in the workflow
                const outputNodes = node.getOutputNodes(slot);
                if (!outputNodes) {
                    continue;
                }
                let onlyWorkflow = true;
                for (const output of outputNodes) {
                    if (!Object.values(workflow).includes(output)) {
                        onlyWorkflow = false;
                        break;
                    }
                }
                if (onlyWorkflow) {
                    // If so, skip this output
                    continue;
                }
                // Otherwise, add the output to the node
                const outputInfo = node.getOutputInfo(slot);
                this.addOutput(outputInfo.name, outputInfo.type);
                nested_slot++;
                // Adding connections
                const linkIDs = outputInfo.links;
                for (const id of linkIDs) {
                    const link = app.graph.links[id];
                    // Add the connection if the target node is not in the workflow
                    const targetNode = app.graph.getNodeById(link.target_id);
                    if (!Object.values(workflow).includes(targetNode)) {
                        this.connect(nested_slot, targetNode, link.target_slot);
                    }
                }
            }
        }
    }

    // inheritWidgets() {
    //     const workflow = this.properties.serializedWorkflow;
    //     this.widgets = [];
    //     this.widgets_values = [];
    //     const widgets = ComfyWidgets;
    //     for (const serialized of workflow) {
    //         const type = serialized.type;
    //         const def = ext.defs[type];
    //         const required = def.input.required;
    //         const optional = def.input.optional;
    //         let inputs = required;
    //         if (optional) {
    //             inputs = Object.assign({}, required, optional);
    //         }
    //         for (const inputName in inputs) {
    //             const inputData = inputs[inputName];
    //             const type = inputData[0];
    //
    //             if(inputData[1]?.forceInput) {
    //                 this.addInput(inputName, type);
    //             } else {
    //                 let isWidget = false;
    //                 if (Array.isArray(type)) {
    //                     // Enums
    //                     widgets.COMBO(this, inputName, inputData, app);
    //                     isWidget = true;
    //                 } else if (`${type}:${inputName}` in widgets) {
    //                     // TODO: Support custom widgets
    //                     isWidget = true;
    //                 } else if (type in widgets) {
    //                     // Standard type widgets
    //                     widgets[type](this, inputName, inputData, app);
    //                     isWidget = true;
    //                 }
    //                 // TODO: Might inherit inputs here instead of a different method
    //                 // else {
    //                 //     // Node connection inputs
    //                 //     this.addInput(inputName, type);
    //                 // }
    //             }
    //         }
    //         // Set the widget to the value stored in the serialized workflow
    //         this.widgets_values = this.widgets_values.concat(serialized.widgets_values);
    //     }
    //     this.configure({title: this.type, widgets_values: this.widgets_values});
    //     // this.configure(this);
    //     for (const widget of this.widgets) {
    //         if (widget.inputEl) {
    //             widget.inputEl.addEventListener("change", () => {
    //                 this.refreshWidgets();
    //             });
    //         }
    //     }
    // }

    inheritWidgets() {
        const workflow = this.properties.serializedWorkflow;
        this.widgets = [];
        this.widgets_values = [];

        for (const node_s of workflow) {
            const type = node_s.type;
            const def = ext.defs[type];
            const node = LiteGraph.createNode(type);
            node.configure(def);
            this.widgets_values = this.widgets_values.concat(node_s.widgets_values);
            this.widgets = this.widgets.concat(node.widgets);
        }
        this.configure({title: this.type, widgets_values: this.widgets_values});
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
        console.log(workflow);

    }

    // Update node on property change
    onPropertyChanged(name, value) {
        if (name === "serializedWorkflow") {
            console.log("serializedWorkflow changed", value);
        }
    }

    refreshWidgets() {
        console.log("refreshing widgets");
        const workflow = this.properties.serializedWorkflow;
        for (const i in workflow) {
            const node = workflow[i];
            for (const j in node.widgets_values) {

            }
        }
    }

    onWidgetChanged(name, value, old_value, widget) {
        this.refreshWidgets();
    }
}
