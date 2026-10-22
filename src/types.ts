export interface ProxyCard {
	id: string | number;
	name: string;
	type: string;
	frameType: string;
	atk?: number | null;
	def?: number | null;
	level?: number | null;
	race?: string | null;
	attribute?: string | null;
	scale?: number | null;
	linkValue?: number | null;
	linkMarkers?: string[] | null;
	fx?: string[] | null;
	art: string;
}
