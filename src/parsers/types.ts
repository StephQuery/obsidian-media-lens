export interface MetadataField {
	key: string;
	value: string;
}

export interface MetadataSection {
	id: string;
	name: string;
	fields: MetadataField[];
	defaultExpanded: boolean;
}
