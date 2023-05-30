import {app} from "../../scripts/app.js";
import {api} from "../../scripts/api.js";
import {NestedNode, nestedNodeTitle, nestedNodeType} from "./nestedNode.js";

export const ext = {
    name: "SS.NestedNodeBuilder",
    defs: {},

    async addCustomNodeDefs(defs, app) {
        console.log(defs);
        defs[nestedNodeType] = {
            category: "Not For Use",
            type: nestedNodeType,
            description: "",
            display_name: "MUST_CREATE_NESTED_NODE_FROM_SELECTION",
            input: {required: {}},
            name: nestedNodeType,
            output: {},
            output_is_list: [],
            output_node: false,
        };
        console.log(api);
        ext.defs = defs;
    },

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== nestedNodeType) {
            return;
        }
        const nestedNodePrototype = NestedNode.prototype;
        // Add the methods from the prototype to the node
        for (const key of Object.getOwnPropertyNames(nestedNodePrototype)) {
            nodeType.prototype[key] = nestedNodePrototype[key];
        }
        nodeType.prototype.isVirtualNode = true;
    },

    loadedGraphNode(node, app) {
        if (node.type !== nestedNodeType) {
            return;
        }
        node.refreshNest();
    },

    nodeCreated(node, app) {
        //
        // Add menu option for nesting nodes for ComfyNodes
        //
        // Save the original options
        const getBaseMenuOptions = node.getExtraMenuOptions;
        node.getExtraMenuOptions = function (_, options) {
            // Call the original function for the default menu options
            getBaseMenuOptions.call(this, _, options);

            // Add new menu options for this extension
            options.push({
                content: "Nest Selected Nodes", callback: () => {
                    ext.nestSelectedNodes();
                }
            });

            // Add a separator
            options.push(null);
        };
    },

    nestSelectedNodes() {
        // Use the selected nodes for the nested node
        const selectedNodes = app.canvas.selected_nodes;

        // Create the nested node
        const nestedNode = LiteGraph.createNode(nestedNodeType);
        nestedNode.title = nestedNodeTitle;
        nestedNode.nestWorkflow(selectedNodes);
    },
};

app.registerExtension(ext);
