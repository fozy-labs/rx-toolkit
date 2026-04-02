export interface Post {
    userId: number;
    id: number;
    title: string;
    body: string;
}

export interface CreatePostDto {
    title: string;
    body: string;
    userId: number;
}

export interface CreatePostCommandArgs extends CreatePostDto {
    tempId: number;
}
