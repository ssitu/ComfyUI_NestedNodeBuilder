# Not used, maybe in the future

import nodes

def createNestedNodeClass(node_def):
    # Create a new class with the node name
    node_name = node_def["name"]

    # Inputs
    @classmethod
    def INPUT_TYPES(s):
        return node_def["inputs"]

    # Entry point
    nested_workflow = node_def["description"]["nestedNodes"]
    def execute_nested_node(self, **kwargs):
        for node in self.nested_workflow:
            nodes.NODE_CLASS_MAPPINGS[node["type"]].execute(node, **kwargs)

    node_class = type(node_name, (object,), {
        "INPUT_TYPES": INPUT_TYPES,
        "RETURN_TYPES": node_def["output"],
        "CATEGORY": "Nested Nodes",
        "FUNCTION": "execute_nested_node",
        "execute_nested_node": execute_nested_node,
        # instance variables
        "nested_workflow": nested_workflow,
    })

    return node_class
