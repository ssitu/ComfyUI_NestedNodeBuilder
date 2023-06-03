import yaml
import shutil
import json
import os

# Paths
ext_path = os.path.dirname(os.path.realpath(__file__))
repo_name = os.path.basename(ext_path)
default_nested_nodes_path = os.path.join(ext_path, "nested_nodes")
js_extensions_path = os.path.join(ext_path, os.pardir, os.pardir, "web", "extensions")
config_path = os.path.join(ext_path, "config.yaml")

# Config keys
config_nested_nodes_path = "nested_nodes_path"


def load_nested_node_defs():
    defs_list = []
    with open(config_path, 'r') as config_file:
        try:
            config = yaml.safe_load(config_file)
        except yaml.YAMLError as yaml_e:
            print("[NestedNodeBuilder] Error loading NestedNodeBuilder config:", yaml_e)
            return

        if config_nested_nodes_path not in config:
            print(
                f'[NestedNodeBuilder] missing entry "{config_nested_nodes_path}" in config.yaml, using default path "{default_nested_nodes_path}"')
        nested_nodes_path = config.get(config_nested_nodes_path, default_nested_nodes_path)
        if not os.path.isabs(nested_nodes_path):
            nested_nodes_path = os.path.join(ext_path, nested_nodes_path)

        # Load each json file in the nested_nodes_path and add it to the defs list
        for file_name in os.listdir(nested_nodes_path):
            if file_name.endswith(".json"):
                with open(f"{nested_nodes_path}/{file_name}", 'r') as json_file:
                    try:
                        node_def = json.load(json_file)
                    except json.JSONDecodeError as json_e:
                        print(f"[NestedNodeBuilder] Error loading {file_name}:", json_e)
                        continue
                    if "name" not in node_def:
                        print("[NestedNodeBuilder] missing property \"name\" in node definition:", file_name)
                        continue
                    defs_list.append(node_def)
    defs = {}
    for node_def in defs_list:
        key = node_def["name"]
        defs[key] = node_def
    return defs


def place_js():
    src = os.path.join(ext_path, "js")
    dst = os.path.join(js_extensions_path, repo_name)
    shutil.copytree(src, dst, dirs_exist_ok=True)


def server_add_def_route():
    # TODO: Find a better way to do this

    import server
    from server import web

    # Save original
    add_routes = server.PromptServer.add_routes

    # Wrapper
    def add_routes_wrapper(self):

        # New route
        @self.routes.get('/nested_node_defs')
        def get_nested_node_defs(self):
            defs = load_nested_node_defs()
            return web.json_response(defs)

        # Add route
        setattr(self, "get_nested_node_defs", get_nested_node_defs)

        # Call original
        add_routes(self)

    # Replace original
    setattr(server.PromptServer, "add_routes", add_routes_wrapper)


server_add_def_route()
place_js()

# This is required so that the extension is displayed as imported successfully
NODE_CLASS_MAPPINGS = {}
__all__ = ["NODE_CLASS_MAPPINGS"]
