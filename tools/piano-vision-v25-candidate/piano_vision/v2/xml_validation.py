"""Offline MusicXML XSD validation against vendored official 4.0 schemas."""
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def schema():
    from lxml import etree
    root=Path(__file__).resolve().parents[2]/'schemas'/'musicxml-4.0'
    class Resolver(etree.Resolver):
        def resolve(self,url,pubid,context):
            name=url.rsplit('/',1)[-1]
            if name in {'musicxml.xsd','xml.xsd','xlink.xsd'}:
                return self.resolve_filename(str(root/name),context)
            raise ValueError('External schema resolution is disabled')
    parser=etree.XMLParser(resolve_entities=False,no_network=True)
    parser.resolvers.add(Resolver())
    return etree.XMLSchema(etree.parse(str(root/'musicxml.xsd'),parser))


def validate_musicxml(xml):
    from lxml import etree
    parser=etree.XMLParser(resolve_entities=False,no_network=True)
    try:
        root=etree.fromstring(xml.encode() if isinstance(xml,str) else xml,parser)
        if root.tag=='opus':return {'valid':False,'errors':['OPUS_SCHEMA_NOT_YET_QUALIFIED'],'version':'MusicXML-4.0'}
        validator=schema();valid=validator.validate(root)
        return {'valid':valid,'errors':[str(e) for e in validator.error_log] if not valid else [],'version':'MusicXML-4.0'}
    except (etree.XMLSyntaxError,ValueError) as error:
        return {'valid':False,'errors':[str(error)],'version':'MusicXML-4.0'}

