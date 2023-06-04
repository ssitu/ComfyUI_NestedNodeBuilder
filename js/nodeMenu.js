import { app } from "../../scripts/app.js";
import { NestedNode, nestedNodeTitle, nestedNodeType, serializeWorkflow } from "./nestedNode.js";
import { $el } from "../../scripts/ui.js";

export const ext = {
    name: "SS.NestedNodeBuilder", defs: {}, nestedDef: {}, nestedNodeDefs: {},

    /**
     * Called before the app registers nodes from definitions.
     * Used to add nested node definitions.
     * @param defs The node definitions.
     * @param app The app.
     * @returns {Promise<void>}
     */
    async addCustomNodeDefs(defs, app) {
        // Save definitions for reference
        this.defs = defs;
        // Grab nested node definitions
        const resp = await fetch("/nested_node_defs")
        const nestedNodeDefs = await resp.json();
        // Merge nested node definitions
        Object.assign(this.nestedNodeDefs, nestedNodeDefs);
        // Add nested node definitions if they exist
        Object.assign(defs, this.nestedNodeDefs);
        console.log("[NestedNodeBuilder] Added nested node definitions:", defs);
    },

    /**
     * Called after inputs, outputs, widgets, menus are added to the node given the node definition.
     * Used to add methods to nested nodes.
     * @param nodeType The ComfyNode object to be registered with LiteGraph.
     * @param nodeData The node definition.
     * @param app The app.
     * @returns {Promise<void>}
     */
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // Return if the node is not a nested node
        let isNestedNode = false;
        for (const defName in this.nestedNodeDefs) {
            if (defName === nodeData.name) {
                isNestedNode = true;
                break;
            }
        }
        if (!isNestedNode) {
            return;
        }


        // Add Nested Node methods to the node ComfyNode
        const nestedNodePrototype = NestedNode.prototype;
        for (const key of Object.getOwnPropertyNames(nestedNodePrototype)) {
            nodeType.prototype[key] = nestedNodePrototype[key];
        }
        nodeType.prototype.isVirtualNode = true;
        console.log("[NestedNodeBuilder] Added nested node methods:", nodeType.prototype);
    },

    /**
     * Called when loading a graph from a JSON file or pasted into the app.
     * @param node The node that was loaded.
     * @param app The app.
     */
    loadedGraphNode(node, app) {
        // Return if the node is not a nested node
        if (!node.properties.serializedWorkflow) {
            return;
        }

        // Return if a nested node definition with the same name already exists
        if (this.nestedNodeDefs[node.type]) {
            return;
        }

        // Use the serialized workflow to create a nested node definition
        const nestedDef = this.createNestedDef(node.properties.serializedWorkflow, node.type);
        console.log("[NestedNodeBuilder] loaded graph node, generated def", nestedDef);

        //
        // If the definition already exists, then the node will be loaded with the existing definition
        //
        for (const defName in this.nestedNodeDefs) {
            const def = this.nestedNodeDefs[defName];
            if (def.name === nestedDef.name) {
                return;
            }
        }

        //
        // When the nested node is loaded but missing def, it can still work.
        // Might remove this in the future.
        //

        // Add the def
        this.nestedNodeDefs[nestedDef.name] = nestedDef;
        // Reload the graph
        LiteGraph.registered_node_types = {};
        app.registerNodes().then(() => {
            // Reload the graph data
            app.loadGraphData(app.graph.serialize());
        }, (error) => {
            console.log("Error registering nodes:", error);
        });
    },

    /**
     * Called when a node is created. Used to add menu options to nodes.
     * @param node The node that was created.
     * @param app The app.
     */
    nodeCreated(node, app) {
        // Save the original options
        const getBaseMenuOptions = node.getExtraMenuOptions;
        // Add new options
        node.getExtraMenuOptions = function (_, options) {
            // Call the original function for the default menu options
            getBaseMenuOptions.call(this, _, options);

            // Add new menu options for this extension
            options.push({
                content: "Nest Selected Nodes", callback: () => {
                    ext.onMenuNestSelectedNodes();
                }
            });

            // Add a separator
            options.push(null);
        };
    },

    createNestedDef(serializedWorkflow, uniqueName) {
        // Replace spaces with underscores for the type
        const uniqueType = uniqueName.replace(/\s/g, "_");
        let nestedDef = {
            name: uniqueType,
            display_name: uniqueName,
            category: "Nested Nodes",
            description: serializedWorkflow,
            input: {},
            output: [],
            output_is_list: [],
            output_name: [],
        };
        for (const id in serializedWorkflow) {
            const node = serializedWorkflow[id];
            const nodeDef = this.defs[node.type];
            // Concatenate inputs
            for (const inputType in nodeDef.input) {
                nestedDef.input[inputType] = Object.assign({}, nestedDef.input[inputType], nodeDef.input[inputType]);
            }
            // Concatenate outputs
            nestedDef.output = nestedDef.output.concat(nodeDef.output);
            nestedDef.output_name = nestedDef.output_name.concat(nodeDef.output_name);
            nestedDef.output_is_list = nestedDef.output_is_list.concat(nodeDef.output_is_list);
        }
        return nestedDef;
    },

    createNestSelectedDialog(selectedNodes) {
        const pos = [window.innerWidth / 3, 2 * window.innerHeight / 3];
        let dialog = app.canvas.createDialog(
            "<span class='name'>" +
            "Name for nested node:" +
            "</span>" +
            "<input autofocus type='text' class='value'/>" +
            "<button>OK</button>",
            { position: pos }
        );
        let input = dialog.querySelector("input");
        const enterName = () => {
            // Check if the name already exists in the defs
            const name = input.value;
            if (name in this.nestedNodeDefs) {
                app.ui.dialog.show(
                    `The name "${name}" is already used for a nested node. Please choose a different name.`
                );
                return;
            } else {
                // Successfully entered a valid name
                this.nestSelectedNodes(selectedNodes, name);
            }
            dialog.close();
        }
        input.addEventListener("keydown", function (e) {
            if (e.keyCode == 27) {
                //ESC
                dialog.close();
            } else if (e.keyCode == 13) {
                // ENTER
                enterName(); // save
            } else if (e.keyCode != 13) {
                dialog.modified();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        });
        let button = dialog.querySelector("button");
        button.addEventListener("click", enterName);
    },

    onMenuNestSelectedNodes() {
        // Use the selected nodes for the nested node
        const selectedNodes = app.canvas.selected_nodes;

        // Prompt user to enter name for the node type
        this.createNestSelectedDialog(selectedNodes);
    },

    nestSelectedNodes(selectedNodes, uniqueName) {
        // Add a custom definition for the nested node
        const nestedDef = this.createNestedDef(serializeWorkflow(selectedNodes), uniqueName);

        // Add the def, this will be added to defs in addCustomNodeDefs
        this.nestedNodeDefs[nestedDef.name] = nestedDef;

        // Download the nested node definition
        saveDef(nestedDef);

        // Register nodes again to add the nested node definition
        LiteGraph.registered_node_types = {};
        app.registerNodes().then(() => {
            // Create the nested node
            const nestedNode = LiteGraph.createNode(nestedDef.name);
            app.graph.add(nestedNode);
            nestedNode.nestWorkflow(selectedNodes);
        }, (error) => {
            console.log("Error registering nodes:", error);
        });
    }
};

app.registerExtension(ext);


function isSerializedWorkflowsEqual(a, b) {
    // Test if two serialized workflows are equal
    if (a.length !== b.length) {
        return false;
    }
    for (const i in a) {
        const nodeA = a[i];
        const nodeB = b[i];
        // Types should be equal
        if (nodeA.type !== nodeB.type) {
            return false;
        }
    }
    return true;
}

function saveDef(nestedDef) {
    const json = JSON.stringify(nestedDef, null, 2); // convert the data to a JSON string
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = $el("a", {
        href: url,
        download: nestedDef.name,
        style: { display: "none" },
        parent: document.body,
    });
    a.click();
    setTimeout(function () {
        a.remove();
        window.URL.revokeObjectURL(url);
    }, 0);
}

