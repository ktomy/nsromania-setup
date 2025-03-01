'use client';

import {useTranslations} from "next-intl";
import React from "react";
import {useParams} from "next/navigation";

export default function RequestDetailsPage() {
    const t = useTranslations('RequestPage');
    const { id } = useParams() as { id: string };

    console.log("Request ID:", id);

    return (
        <div>
            <p>Request ID: {id}</p>
        </div>
    );
}