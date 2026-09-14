import os
import re
import yaml

files = os.listdir("./rime")

schema_list = []
for e in files:
    res=re.fullmatch(r"^(.*)\.schema\.yaml$", e)
    if res is not None:
        schema_list.append(res.group(1))
        
schema_list = sorted(schema_list)

with open("rime/default.custom.yaml", 'w', encoding='utf-8') as f:
    f.write(yaml.safe_dump({"patch": {"schema_list": [{"schema": e} for e in schema_list]}}))

    