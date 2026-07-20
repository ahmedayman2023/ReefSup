/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Camera, MapPin, RefreshCw, Download, X, Info, FolderPlus, Folder, Image as ImageIcon, LogOut, LogIn, ChevronLeft, Save, ArrowLeft, Check, Share2, FolderSync, ZoomIn, ZoomOut, Database, Upload, User as UserIcon, Edit2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, addDoc, query, where, onSnapshot, serverTimestamp, doc, setDoc,
  User, OperationType, handleFirestoreError
} from './firebase';

interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  country?: string;
  timestamp: string;
  rawTimestamp?: string;
}

interface FolderItem {
  id: string;
  name: string;
  ownerId: string;
  createdAt: any;
}

interface PhotoItem {
  id: string;
  folderId: string;
  imageUrl: string;
  latitude: number;
  longitude: number;
  address?: string;
  timestamp?: string;
  ownerId: string;
  createdAt: any;
}

interface UploadedImage {
  id: string;
  src: string;
  name: string;
}

type ViewMode = 'camera' | 'folders' | 'gallery' | 'upload';

const getPhotoDate = (p: PhotoItem): Date => {
  const c: any = p.createdAt;
  if (c?.toDate) return c.toDate();
  if (typeof c === 'string' || typeof c === 'number') return new Date(c);
  if (c instanceof Date) return c;
  return new Date(0);
};

const getPhotoDateLabel = (d: Date): string => {
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dayStart.getTime() === today.getTime()) return 'اليوم';
  if (dayStart.getTime() === yesterday.getTime()) return 'أمس';
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
};

const getPhotoCountLabel = (count: number): string => {
  if (count === 0) return 'لا توجد صور';
  if (count === 1) return 'صورة واحدة';
  if (count === 2) return 'صورتان';
  if (count >= 3 && count <= 10) return `${count} صور`;
  return `${count} صورة`;
};

export default function App() {
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // App State
  const [view, setView] = useState<ViewMode>('camera');
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isFoldersSearchOpen, setIsFoldersSearchOpen] = useState(false);
  const [foldersSearchQuery, setFoldersSearchQuery] = useState('');
  const [folderPhotoCounts, setFolderPhotoCounts] = useState<Record<string, number>>({});

  // Rename Folder State
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');

  // Upload State
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<{ done: number; total: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadMapsUrl, setUploadMapsUrl] = useState('');
  const [isImportingUploadLocation, setIsImportingUploadLocation] = useState(false);

  // Camera State
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [editCity, setEditCity] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLatitude, setEditLatitude] = useState(0);
  const [editLongitude, setEditLongitude] = useState(0);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [searchLocationQuery, setSearchLocationQuery] = useState('');
  const [searchLocationResults, setSearchLocationResults] = useState<any[]>([]);
  const [isSearchingLoc, setIsSearchingLoc] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const mapInstanceRef = useRef<any>(null);
  const markerInstanceRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginErrorType, setLoginErrorType] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>(() => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    return isMobile ? 'environment' : 'user';
  });

  // Zoom State
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [isZoomSupported, setIsZoomSupported] = useState(false);

  // Memoized filtered photos
  const filteredPhotos = useMemo(() => {
    if (!selectedFolder) return [];
    return photos
      .filter(p => p.folderId === selectedFolder.id)
      .sort((a, b) => getPhotoDate(b).getTime() - getPhotoDate(a).getTime());
  }, [photos, selectedFolder]);

  // Photos grouped under date section headers (today / yesterday / full date)
  const groupedPhotos = useMemo(() => {
    const groups: { label: string; photos: PhotoItem[] }[] = [];
    for (const p of filteredPhotos) {
      const label = getPhotoDateLabel(getPhotoDate(p));
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.label === label) {
        lastGroup.photos.push(p);
      } else {
        groups.push({ label, photos: [p] });
      }
    }
    return groups;
  }, [filteredPhotos]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u && u.isAnonymous) {
        await signOut(auth);
        setUser(null);
      } else {
        setUser(u);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Folders Listener
  useEffect(() => {
    if (!user) {
      setFolders([]);
      return;
    }
    if (user.uid === 'guest_user') {
      const storedFolders = localStorage.getItem('guest_folders');
      const folderList = storedFolders ? JSON.parse(storedFolders) : [];
      setFolders(folderList);
      if (folderList.length > 0 && !selectedFolder) {
        setSelectedFolder(folderList[0]);
      }
      return;
    }
    const q = query(collection(db, 'folders'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const folderList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FolderItem));
      setFolders(folderList);
      
      // Auto-select first folder if none selected
      if (folderList.length > 0 && !selectedFolder) {
        setSelectedFolder(folderList[0]);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'folders'));
    return () => unsubscribe();
  }, [user, selectedFolder]);

  // Photos Listener
  useEffect(() => {
    if (!user || !selectedFolder || view !== 'gallery') {
      setPhotos([]);
      return;
    }
    if (user.uid === 'guest_user') {
      const storedPhotos = localStorage.getItem('guest_photos');
      const allPhotos = storedPhotos ? JSON.parse(storedPhotos) : [];
      setPhotos(allPhotos.filter((p: any) => p.folderId === selectedFolder.id));
      return;
    }
    const q = query(
      collection(db, 'photos'), 
      where('ownerId', '==', user.uid),
      where('folderId', '==', selectedFolder.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const photoList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PhotoItem));
      setPhotos(photoList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'photos'));
    return () => unsubscribe();
  }, [user, selectedFolder, view]);

  // Folder Photo Counts Listener (for the folders list view)
  useEffect(() => {
    if (!user || view !== 'folders') return;
    if (user.uid === 'guest_user') {
      const storedPhotos = localStorage.getItem('guest_photos');
      const allPhotos = storedPhotos ? JSON.parse(storedPhotos) : [];
      const counts: Record<string, number> = {};
      allPhotos.forEach((p: any) => { counts[p.folderId] = (counts[p.folderId] || 0) + 1; });
      setFolderPhotoCounts(counts);
      return;
    }
    const q = query(collection(db, 'photos'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const counts: Record<string, number> = {};
      snapshot.docs.forEach(d => {
        const folderId = d.data().folderId;
        counts[folderId] = (counts[folderId] || 0) + 1;
      });
      setFolderPhotoCounts(counts);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'photos'));
    return () => unsubscribe();
  }, [user, view]);

  // Prompt user to create their first folder if none exists
  useEffect(() => {
    if (isAuthReady && user && folders.length === 0 && !isCreatingFolder) {
      setIsCreatingFolder(true);
    }
  }, [isAuthReady, user, folders.length]);

  // Camera Logic
  const startCamera = async () => {
    if (view !== 'camera') return;
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
      } catch (innerErr) {
        newStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode }, 
          audio: false 
        });
      }
      setStream(newStream);
      if (videoRef.current) videoRef.current.srcObject = newStream;
      setError(null);

      // Check for zoom capabilities
      const track = newStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      if (capabilities.zoom) {
        setIsZoomSupported(true);
        setMinZoom(capabilities.zoom.min || 1);
        setMaxZoom(capabilities.zoom.max || 1);
        const settings = track.getSettings() as any;
        setZoom(settings.zoom || 1);
      } else {
        setIsZoomSupported(false);
      }
    } catch (err: any) {
      setError(err.name === 'NotAllowedError' ? "تم رفض الوصول للكاميرا" : "خطأ في الكاميرا");
    }
  };

  const handleZoomChange = async (newZoom: number) => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
      await track.applyConstraints({ advanced: [{ zoom: newZoom }] } as any);
      setZoom(newZoom);
    } catch (err) {
      console.error("Zoom failed", err);
    }
  };

  useEffect(() => {
    if (isAuthReady && user && view === 'camera') {
      startCamera();
      updateLocation();
    } else if (isAuthReady && user && view === 'upload' && !location) {
      updateLocation();
    }
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [facingMode, view, user, isAuthReady]);

  const formatTimestamp = (date: Date) => date.toLocaleString('en-GB', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZoneName: 'short'
  });

  // Converts a Date to the "YYYY-MM-DD" / "HH:mm" values <input type="date"> / <input type="time"> expect, in local time
  const toDateInputValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const toTimeInputValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const updateLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("المتصفح لا يدعم تحديد الموقع");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      const now = new Date();
      const timestamp = formatTimestamp(now);
      const rawTimestamp = now.toISOString();
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
        const data = await response.json();
        setLocation({
          latitude, longitude, timestamp, rawTimestamp,
          address: data.display_name,
          city: data.address.city || data.address.town || data.address.village || "",
          country: data.address.country || ""
        });
      } catch {
        setLocation({ latitude, longitude, timestamp, rawTimestamp });
      }
      setIsLocating(false);
    }, () => {
      setError("يرجى تفعيل الـ GPS وإعطاء صلاحية الموقع للمتصفح");
      setIsLocating(false);
    }, { enableHighAccuracy: true });
  }, []);

  const parseGoogleMapsUrl = (url: string) => {
    try {
      // Regex for: @24.7136,46.6753
      const coordsRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
      const match = url.match(coordsRegex);
      if (match) {
        return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
      }

      // Regex for: q=24.7136,46.6753 or ll=24.7136,46.6753
      const qRegex = /[?&](q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/;
      const qMatch = url.match(qRegex);
      if (qMatch) {
        return { lat: parseFloat(qMatch[2]), lon: parseFloat(qMatch[3]) };
      }

      // Regex for: destination=24.7136,46.6753
      const destRegex = /destination=(-?\d+\.\d+),(-?\d+\.\d+)/;
      const destMatch = url.match(destRegex);
      if (destMatch) {
        return { lat: parseFloat(destMatch[1]), lon: parseFloat(destMatch[2]) };
      }

      // Regex for the precise pin location Google embeds in place links: !3d24.7136!4d46.6753
      const pinRegex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
      const pinMatch = url.match(pinRegex);
      if (pinMatch) {
        return { lat: parseFloat(pinMatch[1]), lon: parseFloat(pinMatch[2]) };
      }

      // Regex for: raw lat, lon separated by commas
      const rawCoordsRegex = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
      const rawMatch = url.match(rawCoordsRegex);
      if (rawMatch) {
        return { lat: parseFloat(rawMatch[1]), lon: parseFloat(rawMatch[2]) };
      }
    } catch (err) {
      console.error("Error parsing maps URL:", err);
    }
    return null;
  };

  const getMapsUrlErrorMessage = (url: string) => {
    if (/goo\.gl|maps\.app\.goo\.gl/i.test(url)) {
      return "هذا رابط مختصر من تطبيق جوجل ماب ولا يحتوي على الإحداثيات مباشرة. افتح الرابط في المتصفح، وانسخ الرابط الكامل من شريط العنوان (الذي يحتوي على @ يتبعه رقمين) والصقه هنا.";
    }
    return "تعذر استخراج الإحداثيات من هذا الرابط. يرجى التأكد من أنه رابط خرائط جوجل صالح يحتوي على الإحداثيات (مثال: @24.7136,46.6753).";
  };

  const handleOpenEditLocation = useCallback(() => {
    if (location) {
      setEditCity(location.city || '');
      setEditAddress(location.address || '');
      setEditLatitude(location.latitude);
      setEditLongitude(location.longitude);
      const baseDate = location.rawTimestamp ? new Date(location.rawTimestamp) : new Date();
      setEditDate(toDateInputValue(baseDate));
      setEditTime(toTimeInputValue(baseDate));
      setGoogleMapsUrl('');
      setSearchLocationQuery('');
      setSearchLocationResults([]);
      setIsEditingLocation(true);
    }
  }, [location]);

  const handleSaveLocation = useCallback(() => {
    if (location) {
      const parsedDate = (editDate && editTime) ? new Date(`${editDate}T${editTime}`) : null;
      const isValidDate = parsedDate && !isNaN(parsedDate.getTime());
      setLocation({
        ...location,
        city: editCity,
        address: editAddress,
        latitude: Number(editLatitude),
        longitude: Number(editLongitude),
        timestamp: isValidDate ? formatTimestamp(parsedDate) : location.timestamp,
        rawTimestamp: isValidDate ? parsedDate.toISOString() : location.rawTimestamp
      });
      setIsEditingLocation(false);
    }
  }, [location, editCity, editAddress, editLatitude, editLongitude, editDate, editTime]);

  const syncMapPosition = useCallback((lat: number, lng: number) => {
    if (mapInstanceRef.current && markerInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 15);
      markerInstanceRef.current.setLatLng([lat, lng]);
    }
  }, []);

  const handleImportGoogleMapsUrl = useCallback(async () => {
    if (!googleMapsUrl.trim()) return;
    const coords = parseGoogleMapsUrl(googleMapsUrl);
    if (!coords) {
      setError(getMapsUrlErrorMessage(googleMapsUrl));
      setTimeout(() => setError(null), 6000);
      return;
    }

    setEditLatitude(coords.lat);
    setEditLongitude(coords.lon);
    syncMapPosition(coords.lat, coords.lon);

    let city: string | undefined;
    let address: string | undefined;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}&zoom=18&addressdetails=1`, {
        headers: { 'Accept-Language': 'ar,en' }
      });
      const data = await response.json();
      if (data) {
        const addr = data.address;
        city = addr.city || addr.town || addr.village || addr.suburb || addr.state || addr.country || "";
        address = data.display_name || "";
        setEditCity(city);
        setEditAddress(address);
      }
    } catch (err) {
      console.error("Reverse geocoding failed", err);
    }

    // Apply immediately so the imported location takes effect even without pressing "حفظ" separately
    setLocation((prev: LocationData | null) => prev ? {
      ...prev,
      latitude: coords.lat,
      longitude: coords.lon,
      ...(city !== undefined ? { city } : {}),
      ...(address !== undefined ? { address } : {})
    } : {
      latitude: coords.lat,
      longitude: coords.lon,
      city: city || '',
      address: address || '',
      timestamp: formatTimestamp(new Date()),
      rawTimestamp: new Date().toISOString()
    });

    setGoogleMapsUrl('');
    setSuccessMessage("تم استيراد الموقع وتطبيقه بنجاح 📍");
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [googleMapsUrl, syncMapPosition]);

  const handleImportUploadMapsUrl = useCallback(async () => {
    if (!uploadMapsUrl.trim()) return;
    const coords = parseGoogleMapsUrl(uploadMapsUrl);
    if (!coords) {
      setError(getMapsUrlErrorMessage(uploadMapsUrl));
      setTimeout(() => setError(null), 6000);
      return;
    }

    setIsImportingUploadLocation(true);
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const rawTimestamp = now.toISOString();

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}&zoom=18&addressdetails=1`, {
        headers: { 'Accept-Language': 'ar,en' }
      });
      const data = await response.json();
      const addr = data?.address || {};
      setLocation({
        latitude: coords.lat,
        longitude: coords.lon,
        timestamp, rawTimestamp,
        address: data?.display_name || "",
        city: addr.city || addr.town || addr.village || addr.suburb || addr.state || "",
        country: addr.country || ""
      });
    } catch (err) {
      console.error("Reverse geocoding failed", err);
      setLocation({ latitude: coords.lat, longitude: coords.lon, timestamp, rawTimestamp });
    }

    setUploadMapsUrl('');
    setIsImportingUploadLocation(false);
    setSuccessMessage("تم استيراد الموقع بنجاح من الرابط 📍");
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [uploadMapsUrl]);

  const handleSearchLocation = useCallback(async () => {
    if (!searchLocationQuery.trim()) return;
    setIsSearchingLoc(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchLocationQuery)}&addressdetails=1&limit=5&accept-language=ar,en`);
      const data = await response.json();
      setSearchLocationResults(data || []);
    } catch (err) {
      console.error("Search failed", err);
      setError("فشل البحث، يرجى المحاولة مرة أخرى");
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsSearchingLoc(false);
    }
  }, [searchLocationQuery]);

  const handleSelectSearchResult = useCallback(async (item: any) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    setEditLatitude(lat);
    setEditLongitude(lon);
    syncMapPosition(lat, lon);
    
    const addr = item.address || {};
    const city = addr.city || addr.town || addr.village || addr.suburb || addr.state || addr.country || "";
    setEditCity(city);
    setEditAddress(item.display_name || "");
    setSearchLocationResults([]);
    setSearchLocationQuery('');
  }, [syncMapPosition]);

  const updateCoordinatesFromMap = useCallback(async (lat: number, lng: number) => {
    setEditLatitude(lat);
    setEditLongitude(lng);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
        headers: { 'Accept-Language': 'ar,en' }
      });
      const data = await response.json();
      if (data) {
        const addr = data.address;
        const city = addr.city || addr.town || addr.village || addr.suburb || addr.state || addr.country || "";
        setEditCity(city);
        setEditAddress(data.display_name || "");
      }
    } catch (err) {
      console.error("Failed to reverse geocode", err);
    }
  }, []);

  // Leaflet map setup hook
  useEffect(() => {
    if (!isEditingLocation) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerInstanceRef.current = null;
      }
      setIsMapReady(false);
      return;
    }

    let active = true;

    const initMap = () => {
      const L = (window as any).L;
      if (!L || !active) return;

      const container = document.getElementById('edit-map-container');
      if (!container) {
        setTimeout(initMap, 100);
        return;
      }

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }

      const initialLat = editLatitude || 24.7136;
      const initialLng = editLongitude || 46.6753;

      const map = L.map('edit-map-container', { zoomControl: false }).setView([initialLat, initialLng], 13);
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      const marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);

      mapInstanceRef.current = map;
      markerInstanceRef.current = marker;
      setIsMapReady(true);

      map.on('click', (e: any) => {
        const { lat, lng } = e.latlng;
        marker.setLatLng([lat, lng]);
        updateCoordinatesFromMap(lat, lng);
      });

      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        updateCoordinatesFromMap(lat, lng);
      });
    };

    if (!(window as any).L) {
      // Inject CSS
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      // Inject JS
      if (!document.getElementById('leaflet-js')) {
        const script = document.createElement('script');
        script.id = 'leaflet-js';
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => {
          initMap();
        };
        document.head.appendChild(script);
      } else {
        const checkLoaded = setInterval(() => {
          if ((window as any).L) {
            clearInterval(checkLoaded);
            initMap();
          }
        }, 100);
      }
    } else {
      setTimeout(initMap, 100);
    }

    return () => {
      active = false;
    };
  }, [isEditingLocation]);

  // Sync edit location fields when real location updates (e.g. from GPS refresh in edit modal)
  useEffect(() => {
    if (isEditingLocation && location) {
      setEditCity(location.city || '');
      setEditAddress(location.address || '');
      setEditLatitude(location.latitude);
      setEditLongitude(location.longitude);
      if (mapInstanceRef.current && markerInstanceRef.current) {
        mapInstanceRef.current.setView([location.latitude, location.longitude], 13);
        markerInstanceRef.current.setLatLng([location.latitude, location.longitude]);
      }
    }
  }, [location, isEditingLocation]);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    if (!location) {
      setError("جاري تحديد الموقع... يرجى الانتظار ثواني أو التأكد من تفعيل GPS");
      updateLocation();
      return;
    }

    const video = videoRef.current;
    if (video.readyState < 2) {
      setError("الكاميرا ليست جاهزة بعد");
      return;
    }

    setIsCapturing(true);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setIsCapturing(false);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Using a more reliable map provider or handling error
      const mapUrl = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${location.longitude},${location.latitude}&z=16&l=map&size=300,300`;
      
      const mapImg = new Image();
      mapImg.crossOrigin = "anonymous";
      
      // Map load timeout for speed
      let mapLoaded = false;
      const mapTimeout = setTimeout(() => {
        if (!mapLoaded) {
          console.warn("Map load timed out, proceeding without map");
          finalizeCapture();
        }
      }, 500);

      const finalizeCapture = async () => {
        if (mapLoaded && !isCapturing) return; // Prevent double execution
        mapLoaded = true;
        clearTimeout(mapTimeout);

        const overlayHeight = canvas.height * 0.28;
        const margin = canvas.width * 0.03;
        const padding = canvas.width * 0.025;
        
        // Background for the overlay
        const bgX = margin;
        const bgY = canvas.height - overlayHeight - margin;
        const bgWidth = canvas.width - (margin * 2);
        const bgHeight = overlayHeight;
        const radius = 25;

        // Draw semi-transparent rounded background
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(bgX, bgY, bgWidth, bgHeight, radius);
          ctx.fill();
        } else {
          ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
        }
        ctx.restore();

        // Map area
        const mapSize = bgHeight - (padding * 2);
        const mapX = bgX + padding;
        const mapY = bgY + padding;

        // Draw map with rounded corners
        ctx.save();
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(mapX, mapY, mapSize, mapSize, 15);
          ctx.clip();
        }
        
        if (mapImg.complete && mapImg.naturalWidth !== 0) {
          ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);
          
          // Red Pin in center of map
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(mapX + mapSize / 2, mapY + mapSize / 2, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Google Logo placeholder (simple text for now)
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = `bold ${Math.max(10, mapSize * 0.1)}px sans-serif`;
          ctx.fillText('Google', mapX + 5, mapY + mapSize - 10);
        } else {
          ctx.fillStyle = '#333';
          ctx.fillRect(mapX, mapY, mapSize, mapSize);
        }
        ctx.restore();

        // Text Content
        const textX = mapX + mapSize + padding;
        let textY = mapY + (canvas.width * 0.04);
        
        // Title: City, Province
        ctx.fillStyle = 'white';
        const titleSize = Math.max(16, canvas.width * 0.032);
        ctx.font = `bold ${titleSize}px sans-serif`;
        
        const locationTitle = `${location.city || 'Dammam'}, ${location.country || 'Saudi Arabia'}`;
        ctx.fillText(locationTitle, textX, textY);
        
        // Address (wrapped)
        textY += titleSize + 8;
        const bodySize = Math.max(11, canvas.width * 0.02);
        ctx.font = `${bodySize}px sans-serif`;
        const maxWidth = bgWidth - (textX - bgX) - padding;
        const words = (location.address || "").split(' ');
        let line = '';
        const lineHeight = bodySize + 4;
        
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            ctx.fillText(line, textX, textY);
            line = words[n] + ' ';
            textY += lineHeight;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, textX, textY);
        
        // Lat/Long
        textY += lineHeight + 6;
        ctx.font = `500 ${bodySize}px sans-serif`;
        ctx.fillText(`Lat ${location.latitude.toFixed(6)}° Long ${location.longitude.toFixed(6)}°`, textX, textY);
        
        // Date/Time
        textY += lineHeight + 4;
        ctx.font = `${bodySize - 1}px sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillText(location.timestamp, textX, textY);

        // Reduced quality for faster processing and saving (0.6 instead of 0.8)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        
        // Flash effect
        setIsFlashing(true);
        setTimeout(() => setIsFlashing(false), 150);

        setCapturedImage(dataUrl);
        setIsCapturing(false); // Move this up for immediate feedback
        
        if (selectedFolder) {
          // Auto-save in background
          saveToFirebase(dataUrl, true);
        }
      };

      mapImg.onload = () => {
        if (!mapLoaded) finalizeCapture();
      };

      mapImg.onerror = () => {
        if (!mapLoaded) {
          console.warn("Failed to load map image, proceeding without map");
          finalizeCapture();
        }
      };

      mapImg.src = mapUrl;
    } catch (err) {
      console.error("Capture error:", err);
      setError("فشل التقاط الصورة");
      setIsCapturing(false);
    }
  }, [location, selectedFolder, updateLocation]);

  const saveToFirebase = useCallback(async (imageToSave?: string, isAuto = false) => {
    const img = imageToSave || capturedImage;
    if (!user || !img || !location) return;
    if (!selectedFolder) {
      setView('folders');
      setIsCreatingFolder(true);
      setError("يرجى إنشاء مجلد أولاً لحفظ الصور");
      return;
    }

    if (!isAuto) setIsSaving(true);
    try {
      const photoData = {
        folderId: selectedFolder.id,
        imageUrl: img,
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address || "",
        timestamp: location.timestamp,
        ownerId: user.uid
      };

      if (user.uid === 'guest_user') {
        const storedPhotos = localStorage.getItem('guest_photos');
        const allPhotos: PhotoItem[] = storedPhotos ? JSON.parse(storedPhotos) : [];
        const newPhoto = {
          id: `photo_${Date.now()}`,
          ...photoData,
          createdAt: new Date().toISOString()
        } as PhotoItem;
        const updatedPhotos = [newPhoto, ...allPhotos];
        localStorage.setItem('guest_photos', JSON.stringify(updatedPhotos));
        
        // Update live photos state if view is gallery
        setPhotos(updatedPhotos.filter(p => p.folderId === selectedFolder.id));
        
        if (!imageToSave) setCapturedImage(null);
        setSuccessMessage(imageToSave ? "تم الحفظ تلقائياً ✨" : "تم حفظ الصورة بنجاح ✨");
        setTimeout(() => setSuccessMessage(null), 3000);
        setError(null);
        return;
      }

      await addDoc(collection(db, 'photos'), {
        ...photoData,
        createdAt: serverTimestamp()
      });
      if (!imageToSave) setCapturedImage(null);
      setSuccessMessage(imageToSave ? "تم الحفظ تلقائياً ✨" : "تم حفظ الصورة بنجاح ✨");
      setTimeout(() => setSuccessMessage(null), 3000);
      setError(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'photos');
    } finally {
      if (!isAuto) setIsSaving(false);
    }
  }, [user, capturedImage, location, selectedFolder]);

  const handleImageFiles = (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;

    Array.from(fileList).forEach(file => {
      if (!file.type.startsWith('image/')) {
        setError(`"${file.name}" ليس صورة صالحة وتم تجاهلها`);
        setTimeout(() => setError(null), 4000);
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => {
        setError(`تعذر قراءة "${file.name}"، حاول مرة أخرى`);
        setTimeout(() => setError(null), 4000);
      };
      reader.onload = (event) => {
        const src = event.target?.result as string;
        setUploadedImages((prev: UploadedImage[]) => [...prev, { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, src, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageFileChange = (e: any) => {
    handleImageFiles(e.target.files);
    e.target.value = '';
  };

  const handleImageDrop = (e: any) => {
    e.preventDefault();
    setIsDraggingFile(false);
    handleImageFiles(e.dataTransfer.files);
  };

  const removeUploadedImage = (id: string) => {
    setUploadedImages((prev: UploadedImage[]) => prev.filter(img => img.id !== id));
  };

  // Draws the location/map stamp onto a single image and resolves with the merged JPEG data URL
  const mergeLocationOntoImage = (imageSrc: string, loc: LocationData): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('no canvas context'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const mapUrl = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${loc.longitude},${loc.latitude}&z=16&l=map&size=300,300`;
        const mapImg = new Image();
        mapImg.crossOrigin = "anonymous";

        let mapLoaded = false;
        const mapTimeout = setTimeout(() => {
          if (!mapLoaded) {
            console.warn("Map load timed out, proceeding without map");
            finalizeMerge();
          }
        }, 3000);

        const finalizeMerge = () => {
          if (mapLoaded) return;
          mapLoaded = true;
          clearTimeout(mapTimeout);

          const overlayHeight = canvas.height * 0.28;
          const margin = canvas.width * 0.03;
          const padding = canvas.width * 0.025;

          const bgX = margin;
          const bgY = canvas.height - overlayHeight - margin;
          const bgWidth = canvas.width - (margin * 2);
          const bgHeight = overlayHeight;
          const radius = 25;

          // Background
          ctx.save();
          ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(bgX, bgY, bgWidth, bgHeight, radius);
            ctx.fill();
          } else {
            ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
          }
          ctx.restore();

          // Map
          const mapSize = bgHeight - (padding * 2);
          const mapX = bgX + padding;
          const mapY = bgY + padding;

          ctx.save();
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(mapX, mapY, mapSize, mapSize, 15);
            ctx.clip();
          }

          if (mapImg.complete && mapImg.naturalWidth !== 0) {
            ctx.drawImage(mapImg, mapX, mapY, mapSize, mapSize);

            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(mapX + mapSize / 2, mapY + mapSize / 2, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = `bold ${Math.max(10, mapSize * 0.1)}px sans-serif`;
            ctx.fillText('Google', mapX + 5, mapY + mapSize - 10);
          } else {
            ctx.fillStyle = '#333';
            ctx.fillRect(mapX, mapY, mapSize, mapSize);
          }
          ctx.restore();

          // Text Content
          const textX = mapX + mapSize + padding;
          let textY = mapY + (canvas.width * 0.04);

          ctx.fillStyle = 'white';
          const titleSize = Math.max(16, canvas.width * 0.032);
          ctx.font = `bold ${titleSize}px sans-serif`;

          const locationTitle = `${loc.city || 'Dammam'}, ${loc.country || 'Saudi Arabia'}`;
          ctx.fillText(locationTitle, textX, textY);

          textY += titleSize + 8;
          const bodySize = Math.max(11, canvas.width * 0.02);
          ctx.font = `${bodySize}px sans-serif`;
          const maxWidth = bgWidth - (textX - bgX) - padding;
          const words = (loc.address || "").split(' ');
          let line = '';
          const lineHeight = bodySize + 4;

          for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            if (ctx.measureText(testLine).width > maxWidth && n > 0) {
              ctx.fillText(line, textX, textY);
              line = words[n] + ' ';
              textY += lineHeight;
            } else {
              line = testLine;
            }
          }
          ctx.fillText(line, textX, textY);

          textY += lineHeight + 6;
          ctx.font = `500 ${bodySize}px sans-serif`;
          ctx.fillText(`Lat ${loc.latitude.toFixed(6)}° Long ${loc.longitude.toFixed(6)}°`, textX, textY);

          textY += lineHeight + 4;
          ctx.font = `${bodySize - 1}px sans-serif`;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fillText(loc.timestamp, textX, textY);

          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };

        mapImg.onload = () => finalizeMerge();
        mapImg.onerror = () => finalizeMerge();
        mapImg.src = mapUrl;
      };

      img.onerror = () => reject(new Error('failed to load image'));
      img.src = imageSrc;
    });
  };

  const mergeLocation = async () => {
    if (uploadedImages.length === 0 || !location) {
      setError("يرجى التأكد من اختيار صورة وتحديد الموقع أولاً");
      return;
    }
    if (!selectedFolder) {
      setError("يرجى تحديد المجلد الذي تود حفظ الصور فيه أولاً");
      setTimeout(() => setError(null), 4000);
      return;
    }

    setIsMerging(true);
    setMergeProgress({ done: 0, total: uploadedImages.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < uploadedImages.length; i++) {
      try {
        const dataUrl = await mergeLocationOntoImage(uploadedImages[i].src, location);
        await saveToFirebase(dataUrl, true);
        successCount++;
      } catch (err) {
        console.error(`Error merging "${uploadedImages[i].name}":`, err);
        failCount++;
      }
      setMergeProgress({ done: i + 1, total: uploadedImages.length });
    }

    setIsMerging(false);
    setMergeProgress(null);
    setUploadedImages([]);

    if (failCount === 0) {
      setSuccessMessage(successCount === 1 ? "تم دمج وحفظ الصورة بنجاح ✨" : `تم دمج وحفظ ${successCount} صور بنجاح ✨`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setError(`تم حفظ ${successCount} صورة، وفشل دمج ${failCount} صورة`);
      setTimeout(() => setError(null), 5000);
    }
  };

  const createFolder = async () => {
    if (!user || !newFolderName.trim()) return;
    try {
      const folderData = {
        name: newFolderName.trim(),
        ownerId: user.uid,
      };

      if (user.uid === 'guest_user') {
        const storedFolders = localStorage.getItem('guest_folders');
        const allFolders = storedFolders ? JSON.parse(storedFolders) : [];
        const newFolder = {
          id: `folder_${Date.now()}`,
          ...folderData,
          createdAt: new Date().toISOString()
        } as FolderItem;
        const updatedFolders = [...allFolders, newFolder];
        localStorage.setItem('guest_folders', JSON.stringify(updatedFolders));
        setFolders(updatedFolders);
        setSelectedFolder(newFolder);
        setNewFolderName('');
        setIsCreatingFolder(false);
        if (view === 'folders') setView('camera');
        return;
      }

      const docRef = await addDoc(collection(db, 'folders'), {
        ...folderData,
        createdAt: serverTimestamp()
      });
      
      // Automatically select the new folder
      setSelectedFolder({
        id: docRef.id,
        ...folderData,
        createdAt: new Date() // Local placeholder
      } as FolderItem);

      setNewFolderName('');
      setIsCreatingFolder(false);
      // Optional: return to camera view if they were in folders view
      if (view === 'folders') setView('camera');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'folders');
    }
  };

  const selectExistingFolder = (folder: FolderItem) => {
    setSelectedFolder(folder);
    setNewFolderName('');
    setIsCreatingFolder(false);
    if (view === 'folders') setView('camera');
  };

  const handleFolderSearchEnter = () => {
    const query = newFolderName.trim();
    if (!query) return;
    const exactMatch = folders.find(f => f.name.trim().toLowerCase() === query.toLowerCase());
    if (exactMatch) {
      selectExistingFolder(exactMatch);
    } else {
      createFolder();
    }
  };

  const handleOpenRenameFolder = (folder: FolderItem) => {
    setRenamingFolder(folder);
    setRenameFolderName(folder.name);
    setIsRenamingFolder(true);
  };

  const renameFolder = async () => {
    if (!user || !renamingFolder || !renameFolderName.trim()) return;
    try {
      const updatedName = renameFolderName.trim();

      if (user.uid === 'guest_user') {
        const storedFolders = localStorage.getItem('guest_folders');
        const allFolders = storedFolders ? JSON.parse(storedFolders) : [];
        const updatedFolders = allFolders.map((f: FolderItem) => 
          f.id === renamingFolder.id ? { ...f, name: updatedName } : f
        );
        localStorage.setItem('guest_folders', JSON.stringify(updatedFolders));
        setFolders(updatedFolders);
        
        if (selectedFolder?.id === renamingFolder.id) {
          setSelectedFolder({ ...selectedFolder, name: updatedName });
        }
        
        setIsRenamingFolder(false);
        setRenamingFolder(null);
        setRenameFolderName('');
        setSuccessMessage("تم تعديل اسم المجلد بنجاح ✨");
        setTimeout(() => setSuccessMessage(null), 3000);
        return;
      }

      await setDoc(doc(db, 'folders', renamingFolder.id), { name: updatedName }, { merge: true });

      if (selectedFolder?.id === renamingFolder.id) {
        setSelectedFolder({ ...selectedFolder, name: updatedName });
      }

      setIsRenamingFolder(false);
      setRenamingFolder(null);
      setRenameFolderName('');
      setSuccessMessage("تم تعديل اسم المجلد بنجاح ✨");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'folders');
    }
  };

  const downloadPhoto = async (imageSrc?: string) => {
    const src = imageSrc || capturedImage;
    if (!src) return;

    // Try Web Share API first (best for mobile gallery)
    if (navigator.share && navigator.canShare) {
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        const file = new File([blob], `ReefSup_Photo_${new Date().getTime()}.jpg`, { type: 'image/jpeg' });
        
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'ReefSup Photo',
          });
          return;
        }
      } catch (err) {
        console.error("Share failed:", err);
      }
    }

    // Fallback to standard download
    const link = document.createElement('a');
    link.href = src;
    link.download = `ReefSup_Photo_${new Date().getTime()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sharePhotos = async () => {
    const selectedPhotos = photos.filter(p => multiSelectedIds.includes(p.id));
    if (selectedPhotos.length === 0) return;

    try {
      if (navigator.share && navigator.canShare) {
        const files = await Promise.all(
          selectedPhotos.map(async (p, i) => {
            const response = await fetch(p.imageUrl);
            const blob = await response.blob();
            return new File([blob], `ReefSup_Photo_${i}_${new Date().getTime()}.jpg`, { type: 'image/jpeg' });
          })
        );

        if (navigator.canShare({ files })) {
          await navigator.share({
            files,
            title: `صور من ${selectedFolder?.name}`,
            text: `تمت مشاركة ${selectedPhotos.length} صورة من تطبيق ReefSupV1.1`,
          });
          return;
        }
      }
      
      if (navigator.share) {
        await navigator.share({
          title: `صور من ${selectedFolder?.name}`,
          text: `تمت مشاركة ${selectedPhotos.length} صورة من تطبيق ReefSupV1.1`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(selectedPhotos[0].imageUrl);
        setSuccessMessage('تم نسخ رابط الصورة الأولى');
      }
    } catch (err) {
      console.error('Error sharing:', err);
      setError('فشل في المشاركة');
    }
  };

  const downloadSelectedPhotos = () => {
    const selectedPhotos = photos.filter((p: PhotoItem) => multiSelectedIds.includes(p.id));
    if (selectedPhotos.length === 0) return;

    selectedPhotos.forEach((p: PhotoItem, i: number) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = p.imageUrl;
        link.download = `ReefSup_Photo_${p.id}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, i * 300);
    });

    setSuccessMessage(selectedPhotos.length === 1 ? "تم تنزيل الصورة ✨" : `جاري تنزيل ${selectedPhotos.length} صور...`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleLogin = async () => {
    console.log("Login button clicked");
    setIsLoggingIn(true);
    setError(null);
    setLoginErrorType(null);
    try {
      console.log("Calling signInWithPopup");
      const result = await signInWithPopup(auth, googleProvider);
      console.log("Login successful:", result.user.uid);
    } catch (err: any) {
      console.error("Login error:", err);
      if (err.code === 'auth/popup-blocked') {
        setError("تم حظر النافذة المنبثقة. يرجى السماح بالمنبثقات في إعدادات المتصفح أو فتح التطبيق في علامة تبويب جديدة.");
        setLoginErrorType('popup-blocked');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError("تم إغلاق نافذة تسجيل الدخول قبل الإكمال.");
        setLoginErrorType('popup-closed');
      } else if (err.code === 'auth/network-request-failed') {
        setError("خطأ في الاتصال بالشبكة. يرجى التحقق من اتصالك.");
        setLoginErrorType('network-failed');
      } else if (err.code === 'auth/unauthorized-domain') {
        setError("هذا النطاق غير مصرح له بتسجيل الدخول. يرجى إضافة رابط التطبيق إلى إعدادات Firebase.");
        setLoginErrorType('unauthorized-domain');
      } else {
        setError(`فشل تسجيل الدخول: ${err.message || "يرجى المحاولة مرة أخرى."}`);
        setLoginErrorType('unknown');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (!isAuthReady) return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(37,99,235,0.15),transparent_70%)] animate-pulse" />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col items-center gap-8"
      >
        <motion.div 
          animate={{ 
            y: [0, -10, 0],
            rotate: [0, 5, -5, 0]
          }}
          transition={{ 
            duration: 4, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          className="w-24 h-24 bg-blue-600 rounded-[2.5rem] flex items-center justify-center shadow-[0_0_50px_rgba(37,99,235,0.3)] border border-blue-400/20"
        >
          <MapPin className="w-12 h-12 text-white" />
        </motion.div>
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-4xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-white/40">ReefSupV1.1</h1>
          <div className="flex items-center gap-3 px-4 py-2 bg-white/5 backdrop-blur-md rounded-full border border-white/10">
            <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Initializing Experience</span>
          </div>
        </div>
      </motion.div>
    </div>
  );

  if (isAuthReady && !user) {
    return (
      <div className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-center font-sans relative overflow-hidden p-6">
        <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(37,99,235,0.15),transparent_70%)] pointer-events-none" />
        <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 flex flex-col items-center max-w-sm w-full"
        >
          <div className="w-24 h-24 bg-blue-600/20 rounded-3xl flex items-center justify-center mb-8 border border-blue-500/30 shadow-2xl shadow-blue-900/20">
            <MapPin className="w-12 h-12 text-blue-400" />
          </div>
          <h1 className="text-4xl font-bold mb-4 tracking-tight drop-shadow-md">ReefSupV1.1</h1>
          <p className="text-zinc-400 text-center mb-10 leading-relaxed">
            قم بتسجيل الدخول لحفظ صورك ومجلداتك بأمان على السحابة والوصول إليها من أي مكان.
          </p>
          
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm text-center font-medium flex flex-col gap-2"
            >
              <span>{error}</span>
              {window.self !== window.top && (
                <span className="text-xs text-red-300">
                  يبدو أنك تستخدم التطبيق داخل إطار (iframe). يرجى فتح التطبيق في علامة تبويب جديدة لتتمكن من تسجيل الدخول.
                </span>
              )}
              {loginErrorType === 'unauthorized-domain' && (
                <div className="mt-2 text-right text-xs bg-black/40 p-3 rounded-xl border border-red-500/10 text-zinc-300 flex flex-col gap-1.5 leading-relaxed" dir="rtl">
                  <p className="font-bold text-red-300">💡 لإصلاح هذه المشكلة في إعدادات Firebase:</p>
                  <ol className="list-decimal list-inside flex flex-col gap-1 text-[11px] text-zinc-400">
                    <li>افتح لوحة تحكم <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-blue-400 underline">Firebase Console</a></li>
                    <li>اذهب إلى <span className="text-white">Authentication</span> &gt; <span className="text-white">Settings</span> &gt; <span className="text-white">Authorized domains</span></li>
                    <li>أضف النطاق الحالي الخاص بك للتصريح:</li>
                  </ol>
                  <div className="bg-zinc-950 p-2 rounded border border-white/5 font-mono text-[10px] text-center select-all break-all text-blue-300">
                    {window.location.hostname}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">تلميح: يمكنك الضغط على "الاستمرار كزائر" بالأسفل لتخزين بياناتك محلياً بالمتصفح والبدء مباشرة!</p>
                </div>
              )}
            </motion.div>
          )}

          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full bg-white text-black py-4 rounded-2xl font-bold shadow-xl shadow-white/10 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3 text-lg cursor-pointer"
          >
            {isLoggingIn ? (
              <RefreshCw className="w-6 h-6 animate-spin" />
            ) : (
              <LogIn className="w-6 h-6" />
            )}
            تسجيل الدخول باستخدام جوجل
          </button>

          <button 
            onClick={() => setUser({ uid: 'guest_user', displayName: 'زائر', email: 'guest@reefapp.local', emailVerified: true, isAnonymous: false, metadata: {}, providerData: [], providerId: 'custom', tenantId: null } as any)}
            className="w-full mt-4 bg-zinc-900 hover:bg-zinc-800 text-white border border-white/10 py-4 rounded-2xl font-bold active:scale-95 transition-all flex items-center justify-center gap-3 text-lg cursor-pointer shadow-lg"
          >
            <UserIcon className="w-6 h-6 text-zinc-400" />
            الاستمرار كزائر (تخزين محلي)
          </button>

          {window.self !== window.top && (
            <a 
              href={window.location.href} 
              target="_blank" 
              rel="noopener noreferrer"
              className="w-full mt-4 bg-blue-600/20 text-blue-400 border border-blue-500/30 py-4 rounded-2xl font-bold active:scale-95 transition-all flex items-center justify-center gap-3 text-lg"
            >
              فتح التطبيق في نافذة جديدة
            </a>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-black text-white flex flex-col font-sans selection:bg-blue-500/30 overflow-hidden relative">
      {view !== 'folders' && <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(37,99,235,0.08),transparent_70%)] pointer-events-none" />}
      {view !== 'folders' && <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />}
      {/* Header */}
      <header className={`${view === 'camera' ? 'absolute' : 'relative bg-zinc-950 border-b border-white/5'} top-0 left-0 right-0 p-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-50`}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg shadow-lg shadow-blue-900/20">
              <MapPin className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight drop-shadow-md">ReefSupV1.1</h1>
          </div>

          {/* Go to Folders Button */}
          <button
            onClick={() => { setView('folders'); setUploadedImages([]); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all duration-300 text-xs font-bold cursor-pointer shadow-lg ${
              view === 'folders' 
                ? 'bg-blue-600 text-white border-blue-500 shadow-blue-600/20' 
                : 'bg-white/10 hover:bg-white/20 text-white border-white/10 hover:border-white/20'
            }`}
            title="الذهاب إلى صفحة المجلدات"
          >
            <Folder className="w-4 h-4 shrink-0 text-blue-400" />
            <span className="hidden sm:inline">صفحة المجلدات</span>
            <span className="sm:hidden">المجلدات</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Camera Button */}
          <button 
            onClick={() => { setView('camera'); setUploadedImages([]); }}
            className={`p-2 backdrop-blur-md rounded-full transition-colors border border-white/10 ${view === 'camera' ? 'bg-blue-600 text-white border-blue-500' : 'bg-black/40 text-zinc-400 hover:bg-zinc-800'}`}
            title="الكاميرا"
          >
            <Camera className="w-5 h-5" />
          </button>
          
          {/* Upload Button */}
          <button 
            onClick={() => { setView('upload'); setUploadedImages([]); }}
            className={`p-2 backdrop-blur-md rounded-full transition-colors border border-white/10 ${view === 'upload' ? 'bg-blue-600 text-white border-blue-500' : 'bg-black/40 text-zinc-400 hover:bg-zinc-800'}`}
            title="دمج موقع وصورة"
          >
            <Upload className="w-5 h-5" />
          </button>

          {/* Folders Button */}
          <button 
            onClick={() => { setView('folders'); setUploadedImages([]); }}
            className={`p-2 backdrop-blur-md rounded-full transition-colors border border-white/10 ${view === 'folders' ? 'bg-blue-600 text-white border-blue-500' : 'bg-black/40 text-zinc-400 hover:bg-zinc-800'}`}
            title="المجلدات"
          >
            <Folder className="w-5 h-5" />
          </button>

          {user && (
            <button 
              onClick={async () => {
                if (user.uid === 'guest_user') {
                  setUser(null);
                } else {
                  await signOut(auth);
                }
              }}
              className="p-2 bg-black/40 backdrop-blur-md hover:bg-zinc-800 rounded-full transition-colors text-red-400 border border-white/10 cursor-pointer"
              title="تسجيل الخروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className={`flex-1 relative ${view === 'camera' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'} pt-0`}>
        <AnimatePresence mode="wait">
          {/* Camera View */}
          {view === 'camera' && (
            <motion.div 
              key="camera"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="w-full h-full relative flex flex-col"
            >
              <div className="flex-1 relative bg-zinc-900 overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* Selected Folder Indicator */}
                {selectedFolder && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 z-20 flex items-center gap-2 shadow-lg max-w-[80%] truncate"
                  >
                    <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="text-xs font-bold text-white truncate">يتم الحفظ في: {selectedFolder.name}</span>
                  </motion.div>
                )}

                {/* Flash Effect */}
                <AnimatePresence>
                  {isFlashing && (
                    <motion.div 
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="absolute inset-0 bg-white z-[100] pointer-events-none"
                    />
                  )}
                </AnimatePresence>

                {/* Success Message */}
                <AnimatePresence>
                  {successMessage && (
                    <motion.div 
                      initial={{ opacity: 0, y: -50, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -50, scale: 0.9 }}
                      className="absolute top-20 left-1/2 -translate-x-1/2 bg-green-500/90 backdrop-blur-md px-6 py-3 rounded-2xl flex items-center gap-3 shadow-2xl z-[100] border border-green-400/20"
                    >
                      <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                        <Check className="w-5 h-5 text-white" />
                      </div>
                      <span className="font-bold text-white text-sm">{successMessage}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Location Requirement Overlay */}
                {!location && !capturedImage && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center"
                  >
                    <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mb-6">
                      <MapPin className={`w-10 h-10 text-blue-400 ${isLocating ? 'animate-bounce' : 'animate-pulse'}`} />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-3">تحديد الموقع مطلوب</h3>
                    <p className="text-zinc-400 mb-8 max-w-xs leading-relaxed">
                      يرجى تفعيل الـ GPS والسماح للمتصفح بالوصول إلى موقعك لتتمكن من التقاط الصور.
                    </p>
                    <button 
                      onClick={updateLocation}
                      disabled={isLocating}
                      className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold shadow-xl shadow-blue-600/20 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {isLocating ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          جاري تحديد الموقع...
                        </>
                      ) : (
                        "المحاولة مرة أخرى"
                      )}
                    </button>
                  </motion.div>
                )}

                {/* Location Overlay */}
                {location && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={handleOpenEditLocation}
                    className="absolute bottom-6 left-6 right-28 bg-black/60 hover:bg-black/80 hover:border-blue-500/50 cursor-pointer group transition-all duration-300 backdrop-blur-xl p-3 rounded-2xl border border-white/10 z-10 shadow-2xl flex items-center justify-between"
                    title="تعديل الموقع الجغرافي"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 bg-blue-600/30 rounded-xl flex items-center justify-center border border-blue-500/20 group-hover:bg-blue-600/40 transition-colors shrink-0">
                        <MapPin className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
                      </div>
                      <div className="flex-1 text-xs text-right overflow-hidden">
                        <p className="font-bold text-sm text-white/90 tracking-tight">{location.city || 'تحديد الموقع...'}</p>
                        <p className="text-white/50 line-clamp-1 font-medium">{location.address}</p>
                      </div>
                    </div>
                    <div className="p-2 bg-white/5 rounded-lg border border-white/5 text-zinc-400 group-hover:text-white group-hover:bg-blue-600/20 group-hover:border-blue-500/30 transition-all shrink-0">
                      <Edit2 className="w-4 h-4" />
                    </div>
                  </motion.div>
                )}

              {/* Zoom Controls */}
              {isZoomSupported && (
                <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-4 bg-black/40 backdrop-blur-xl p-3 rounded-full border border-white/10 z-20 shadow-2xl">
                  <motion.button 
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleZoomChange(Math.min(maxZoom, zoom + (maxZoom - minZoom) * 0.1))}
                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                  >
                    <ZoomIn className="w-5 h-5 text-white" />
                  </motion.button>
                  
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-xs font-bold text-white/80">{zoom.toFixed(1)}x</span>
                  </div>

                  <motion.button 
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleZoomChange(Math.max(minZoom, zoom - (maxZoom - minZoom) * 0.1))}
                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                  >
                    <ZoomOut className="w-5 h-5 text-white" />
                  </motion.button>
                </div>
              )}

              {/* Vertical Camera Controls on the Right */}
              <div className="absolute right-0 top-0 bottom-0 w-24 flex flex-col items-center justify-center gap-8 bg-gradient-to-l from-black/60 to-transparent z-20">
                <motion.button 
                  whileHover={{ scale: 1.1, rotate: 15 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setFacingMode(f => f === 'user' ? 'environment' : 'user')}
                  className="w-12 h-12 rounded-full bg-zinc-800/80 backdrop-blur-xl flex items-center justify-center border border-white/10 shadow-lg"
                >
                  <RefreshCw className="w-6 h-6" />
                </motion.button>

                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={capturePhoto}
                  disabled={isCapturing}
                  className={`w-20 h-20 rounded-full border-4 border-white flex items-center justify-center p-1 shadow-2xl transition-all ${isCapturing ? 'opacity-50' : ''}`}
                >
                  <div className="w-full h-full rounded-full bg-white flex items-center justify-center shadow-inner">
                    {isCapturing ? (
                      <RefreshCw className="w-10 h-10 text-black animate-spin" />
                    ) : (
                      <Camera className="w-10 h-10 text-black" />
                    )}
                  </div>
                </motion.button>

                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setView('folders')}
                  className="w-12 h-12 rounded-full bg-zinc-800/80 backdrop-blur-xl flex items-center justify-center relative border border-white/10 shadow-lg"
                >
                  <Folder className="w-6 h-6" />
                  {selectedFolder && <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-black shadow-sm" />}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Folders List View */}
        {view === 'folders' && (
          <motion.div 
            key="folders"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full relative flex flex-col bg-zinc-950 min-h-full pb-28"
          >
            <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
              <div className="flex items-center justify-between mb-8 gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-12 h-12 shrink-0 bg-gradient-to-br from-blue-600/25 to-blue-900/10 rounded-2xl flex items-center justify-center border border-blue-500/20 shadow-lg shadow-blue-900/10">
                    <Folder className="w-6 h-6 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">المجلدات</h2>
                    <p className="text-xs text-zinc-500 mt-1">
                      {folders.length > 0 ? `${folders.length} ${folders.length === 1 ? 'مجلد' : 'مجلدات'} · نظّم صورك بسهولة` : 'نظم صورك في مجلدات مخصصة'}
                    </p>
                  </div>
                </div>
                {folders.length > 0 && (
                  <div className="flex items-center gap-2 shrink-0">
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setIsFoldersSearchOpen(prev => !prev);
                        if (isFoldersSearchOpen) setFoldersSearchQuery('');
                      }}
                      className={`p-2.5 rounded-2xl border transition-colors cursor-pointer ${isFoldersSearchOpen ? 'bg-blue-600 text-white border-blue-500' : 'bg-zinc-900/60 text-zinc-400 border-white/5 hover:text-white hover:border-white/15'}`}
                      title="بحث عن مجلد"
                    >
                      <Search className="w-4 h-4" />
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setIsCreatingFolder(true)}
                      className="hidden sm:flex items-center gap-2 bg-white text-black px-5 py-2.5 rounded-2xl font-bold text-sm shadow-xl shadow-white/5 hover:bg-zinc-200 transition-colors cursor-pointer"
                    >
                      <FolderPlus className="w-4 h-4" />
                      مجلد جديد
                    </motion.button>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {isFoldersSearchOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="relative">
                      <Search className="w-4 h-4 text-zinc-600 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="ابحث باسم المجلد..."
                        value={foldersSearchQuery}
                        onChange={e => setFoldersSearchQuery(e.target.value)}
                        className="w-full bg-zinc-900/60 border border-white/5 rounded-2xl p-3.5 pr-11 pl-11 text-sm placeholder-zinc-600 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {foldersSearchQuery && (
                        <button
                          onClick={() => setFoldersSearchQuery('')}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                layout
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {folders
                  .filter(f => f.name.toLowerCase().includes(foldersSearchQuery.trim().toLowerCase()))
                  .map((f, i) => {
                  const isSelected = selectedFolder?.id === f.id;
                  return (
                    <motion.div
                      key={f.id}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={{ y: -3 }}
                      className={`group relative flex flex-col rounded-3xl border transition-colors duration-300 overflow-hidden ${isSelected ? 'border-blue-500/60 shadow-xl shadow-blue-950/30' : 'border-white/5 hover:border-white/15 shadow-lg shadow-black/20'} ${isSelected ? 'bg-gradient-to-br from-blue-600/15 via-zinc-900 to-zinc-900' : 'bg-zinc-900/50 hover:bg-zinc-900/80'}`}
                    >
                      {isSelected && (
                        <div className="absolute top-3.5 left-3.5 flex items-center gap-1 bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg shadow-blue-500/30 z-10">
                          <Check className="w-3 h-3" strokeWidth={3} />
                          محدد الآن
                        </div>
                      )}

                      <div className="absolute top-3.5 right-3.5 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenRenameFolder(f); }}
                          className="p-2 text-zinc-300 hover:text-blue-400 bg-black/40 backdrop-blur-md rounded-full transition-colors cursor-pointer"
                          title="تعديل اسم المجلد"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="relative p-5 pt-16 flex flex-col flex-1">
                        <div className="relative h-24 mb-4 shrink-0">
                          {/* soft ambient shadow */}
                          <div className={`absolute bottom-0 inset-x-5 h-4 rounded-full blur-xl transition-colors ${isSelected ? 'bg-blue-500/40' : 'bg-black/30'}`} />

                          {/* folder back + tab (glass) */}
                          <div className={`absolute inset-x-1 top-1 bottom-0 rounded-2xl backdrop-blur-sm border transition-colors ${isSelected ? 'bg-blue-400/20 border-blue-300/30' : 'bg-white/[0.06] border-white/10 group-hover:bg-white/[0.09]'}`} />
                          <div className={`absolute top-0 right-4 w-9 h-3.5 rounded-t-lg backdrop-blur-sm transition-colors ${isSelected ? 'bg-blue-400/30' : 'bg-white/10'}`} />

                          {/* papers peeking out */}
                          <div className={`absolute top-3 left-1/2 -translate-x-1/2 w-[58%] h-14 rounded-xl shadow-lg rotate-[4deg] p-2.5 flex flex-col gap-1.5 transition-colors ${isSelected ? 'bg-white' : 'bg-zinc-200'}`}>
                            <div className="h-1.5 w-3/4 bg-black/10 rounded-full" />
                            <div className="h-1.5 w-1/2 bg-black/10 rounded-full" />
                            <div className="h-1.5 w-2/3 bg-black/10 rounded-full" />
                          </div>

                          {/* front pocket (frosted glass, blurs papers behind it) */}
                          <div className={`absolute bottom-0 inset-x-0 h-14 rounded-2xl overflow-hidden backdrop-blur-md border shadow-xl transition-colors ${isSelected ? 'bg-gradient-to-br from-blue-300/25 via-blue-500/15 to-blue-600/20 border-blue-200/30' : 'bg-gradient-to-br from-white/10 via-white/5 to-white/0 border-white/15 group-hover:from-white/15'}`}>
                            <div className="absolute -top-6 -left-6 w-20 h-20 bg-white/25 rounded-full blur-2xl" />
                          </div>
                        </div>
                        <h3 className="font-bold text-lg mb-1 truncate">{f.name}</h3>
                        <p className="text-xs mb-5 text-zinc-500">
                          {getPhotoCountLabel(folderPhotoCounts[f.id] || 0)}
                        </p>

                        <div className="flex gap-2.5 mt-auto pt-4 border-t border-white/5">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => { setSelectedFolder(f); setView('camera'); }}
                            className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-3 rounded-xl font-bold transition-colors cursor-pointer ${isSelected ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white text-black hover:bg-zinc-200 shadow-lg shadow-white/5'}`}
                          >
                            <Camera className="w-3.5 h-3.5" />
                            {isSelected ? 'محدد' : 'اختيار'}
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => { setSelectedFolder(f); setView('gallery'); }}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-zinc-800/80 backdrop-blur-md py-3 rounded-xl font-bold border border-white/5 hover:bg-zinc-700 transition-colors text-white cursor-pointer"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            عرض الصور
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>

              {folders.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative text-center py-24 px-6 bg-zinc-900/30 rounded-[2rem] border border-dashed border-white/10 mt-4 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.12),transparent_60%)] pointer-events-none" />
                  <div className="relative w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-blue-600/20 to-blue-900/5 border border-blue-500/10 flex items-center justify-center">
                    <Folder className="w-9 h-9 text-blue-400/70" />
                  </div>
                  <h3 className="relative text-lg font-bold text-zinc-200 mb-2">ابدأ بإنشاء مجلد</h3>
                  <p className="relative text-sm text-zinc-500 mb-8 max-w-[220px] mx-auto leading-relaxed">تحتاج إلى مجلد لحفظ الصور الملتقطة وتنظيمها</p>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setIsCreatingFolder(true)}
                    className="relative bg-white text-black px-8 py-3 rounded-2xl font-bold shadow-xl cursor-pointer inline-flex items-center gap-2"
                  >
                    <FolderPlus className="w-4 h-4" />
                    إنشاء أول مجلد
                  </motion.button>
                </motion.div>
              )}

              {folders.length > 0 && foldersSearchQuery.trim() && folders.filter(f => f.name.toLowerCase().includes(foldersSearchQuery.trim().toLowerCase())).length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center py-20 px-6 bg-zinc-900/30 rounded-[2rem] border border-dashed border-white/10 mt-4"
                >
                  <Search className="w-10 h-10 mx-auto mb-4 text-zinc-700" />
                  <h3 className="text-sm font-bold text-zinc-300 mb-1">لا توجد نتائج</h3>
                  <p className="text-xs text-zinc-500">لا يوجد مجلد يطابق "{foldersSearchQuery.trim()}"</p>
                </motion.div>
              )}
            </div>

            {/* Floating Action Button for Create Folder */}
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsCreatingFolder(true)}
              className="sm:hidden fixed bottom-6 right-6 w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-600/40 z-50 cursor-pointer"
              title="مجلد جديد"
            >
              <FolderPlus className="w-8 h-8 text-white" />
            </motion.button>
          </motion.div>
        )}

        {/* Upload and Merge View */}
        {view === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full relative flex flex-col bg-zinc-950 min-h-full pb-24 p-6"
          >
            <div className="max-w-xl mx-auto w-full">
              <div className="mb-8 flex items-center gap-3">
                <div className="w-11 h-11 bg-blue-600/15 rounded-2xl flex items-center justify-center border border-blue-500/20 shrink-0">
                  <FolderSync className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">دمج الموقع بالصور</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">ارفع أي صورة من جهازك ليتم ختم بيانات موقعك الحالي وخريطة تفاعلية عليها</p>
                </div>
              </div>

              {/* Selected Folder Indicator */}
              {selectedFolder ? (
                <div className="mb-5 p-4 bg-zinc-900 rounded-2xl border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center border border-blue-500/10 shrink-0">
                      <Folder className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="text-right min-w-0">
                      <p className="text-xs text-zinc-500">سيتم حفظ الصورة المدمجة في</p>
                      <p className="text-sm font-bold text-white truncate">{selectedFolder.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setView('folders')}
                    className="text-xs text-blue-400 font-bold hover:underline shrink-0 cursor-pointer"
                  >
                    تغيير المجلد
                  </button>
                </div>
              ) : (
                <div className="mb-5 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl text-yellow-400 text-sm flex flex-col gap-3">
                  <p className="font-bold">يرجى تحديد المجلد الذي تود حفظ الصور فيه أولاً.</p>
                  <button
                    onClick={() => setView('folders')}
                    className="bg-yellow-500 text-black px-4 py-2 rounded-xl font-bold text-xs self-start cursor-pointer"
                  >
                    الذهاب للمجلدات
                  </button>
                </div>
              )}

              <AnimatePresence mode="wait">
                {uploadedImages.length === 0 ? (
                  /* File Upload Dropzone */
                  <motion.div
                    key="dropzone"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    onDragEnter={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDraggingFile(false); }}
                    onDrop={handleImageDrop}
                    className={`relative group border-2 border-dashed rounded-[2rem] p-10 text-center transition-all ${isDraggingFile ? 'border-blue-500 bg-blue-500/10 scale-[1.01]' : 'border-zinc-800 hover:border-blue-500/40 bg-zinc-900/20'}`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="flex flex-col items-center gap-4 pointer-events-none">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isDraggingFile ? 'bg-blue-500/20 text-blue-300 scale-110' : 'bg-blue-500/10 text-blue-400 group-hover:scale-110'}`}>
                        <ImageIcon className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg mb-1">{isDraggingFile ? 'أفلت الصور هنا' : 'اختر صورة أو أكثر أو اسحبها هنا'}</h3>
                        <p className="text-xs text-zinc-500">يدعم صيغ JPG، PNG، WEBP وغيرها — يمكنك اختيار عدة صور دفعة واحدة</p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-5"
                  >
                    {/* Selected Images Grid */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-zinc-400">{uploadedImages.length} صورة محددة</p>
                        <button
                          onClick={() => setUploadedImages([])}
                          disabled={isMerging}
                          className="text-xs text-red-400 font-bold hover:underline cursor-pointer disabled:opacity-50"
                        >
                          مسح الكل
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {uploadedImages.map((image, idx) => (
                          <div key={image.id} className="relative aspect-square rounded-2xl overflow-hidden border border-white/5 bg-zinc-900">
                            <img src={image.src} alt={image.name} className="w-full h-full object-cover" />
                            {isMerging && mergeProgress && idx < mergeProgress.done && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <Check className="w-6 h-6 text-green-400" />
                              </div>
                            )}
                            {!isMerging && (
                              <button
                                onClick={() => removeUploadedImage(image.id)}
                                className="absolute top-1.5 right-1.5 p-1.5 bg-black/60 backdrop-blur-md rounded-full text-zinc-300 hover:text-white transition-colors border border-white/10 cursor-pointer"
                                title="إزالة الصورة"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        {!isMerging && (
                          <label className="relative aspect-square rounded-2xl border-2 border-dashed border-zinc-800 hover:border-blue-500/40 flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-blue-400 cursor-pointer transition-colors">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={handleImageFileChange}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <ImageIcon className="w-5 h-5 pointer-events-none" />
                            <span className="text-[10px] font-bold pointer-events-none">إضافة</span>
                          </label>
                        )}
                      </div>
                    </div>

                    {/* Google Maps Link Import */}
                    <div className="p-4 bg-zinc-900 rounded-2xl border border-white/5 flex flex-col gap-2">
                      <label className="text-xs font-bold text-zinc-400">أو الصق رابط خرائط جوجل مباشرة</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="الصق رابط الموقع أو الإحداثيات هنا..."
                          value={uploadMapsUrl}
                          onChange={e => setUploadMapsUrl(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleImportUploadMapsUrl()}
                          className="flex-1 bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleImportUploadMapsUrl}
                          disabled={isImportingUploadLocation || !uploadMapsUrl.trim()}
                          className="bg-blue-600 hover:bg-blue-500 px-4 py-2.5 rounded-xl font-bold text-xs transition-colors shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {isImportingUploadLocation && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                          استيراد
                        </button>
                      </div>
                    </div>

                    {/* Active Location Card */}
                    {location ? (
                      <div className="p-4 bg-zinc-900 hover:bg-zinc-800/80 hover:border-blue-500/30 transition-all cursor-pointer group rounded-2xl border border-white/5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0" onClick={handleOpenEditLocation}>
                          <div className="w-10 h-10 bg-blue-600/30 rounded-xl flex items-center justify-center border border-blue-500/20 shrink-0 group-hover:bg-blue-600/40 transition-colors">
                            <MapPin className="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" />
                          </div>
                          <div className="flex-1 min-w-0 text-right font-medium">
                            <p className="font-bold text-sm text-white truncate">{location.city || 'تحديد الموقع...'}</p>
                            <p className="text-xs text-zinc-500 truncate mt-0.5">{location.address}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={handleOpenEditLocation}
                            className="p-2 bg-zinc-800 hover:bg-zinc-700 hover:text-white rounded-full text-zinc-400 transition-colors cursor-pointer"
                            title="تعديل الموقع"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={updateLocation}
                            disabled={isLocating}
                            className="p-2 bg-zinc-800 hover:bg-zinc-700 hover:text-white rounded-full text-zinc-400 transition-colors cursor-pointer disabled:opacity-50"
                            title="تحديث الموقع"
                          >
                            <RefreshCw className={`w-4 h-4 ${isLocating ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </div>
                    ) : isLocating ? (
                      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-300 text-sm flex items-center gap-3">
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                        <span>جاري تحديد موقعك الجغرافي...</span>
                      </div>
                    ) : (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center justify-between gap-3">
                        <span>تعذر تحديد موقعك، تأكد من تفعيل الـ GPS</span>
                        <button
                          onClick={updateLocation}
                          className="bg-red-500 text-white px-3 py-1.5 rounded-xl font-bold text-xs shrink-0 cursor-pointer"
                        >
                          إعادة المحاولة
                        </button>
                      </div>
                    )}

                    {/* Merge Action Button */}
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={mergeLocation}
                      disabled={isMerging || !location || !selectedFolder}
                      className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-xl shadow-blue-600/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3 text-lg cursor-pointer"
                    >
                      {isMerging ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin" />
                          {mergeProgress ? `جاري الحفظ... (${mergeProgress.done} من ${mergeProgress.total})` : 'جاري دمج الموقع والتوليد...'}
                        </>
                      ) : (
                        <>
                          <FolderSync className="w-6 h-6" />
                          {uploadedImages.length > 1 ? `دمج الموقع وحفظ ${uploadedImages.length} صور` : 'دمج الموقع وحفظ الصورة'}
                        </>
                      )}
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* Gallery View */}
        {view === 'gallery' && selectedFolder && (
          <motion.div 
            key="gallery"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="w-full relative flex flex-col bg-zinc-950 min-h-full pb-24"
          >
            <div className="flex-1 flex flex-col">
              <div className="p-4 flex items-center justify-between bg-zinc-900/80 backdrop-blur-xl border-b border-white/5 sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => {
                      setView('folders');
                      setIsSelectMode(false);
                      setMultiSelectedIds([]);
                    }}
                    className="p-2 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">{selectedFolder.name}</h2>
                    <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{photos.length} صورة موجودة</p>
                  </div>
                </div>
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setIsSelectMode(!isSelectMode);
                    setMultiSelectedIds([]);
                  }}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all shadow-lg ${isSelectMode ? 'bg-blue-600 text-white shadow-blue-500/20' : 'bg-zinc-800 text-zinc-300 border border-white/5'}`}
                >
                  {isSelectMode ? 'إلغاء التحديد' : 'تحديد الصور'}
                </motion.button>
              </div>
              
              <div className="flex-1 flex flex-col">
                {groupedPhotos.map((group) => (
                  <div key={group.label}>
                    <div className="px-4 py-2 sticky top-[57px] z-[5] bg-zinc-950/90 backdrop-blur-xl">
                      <h3 className="text-xs font-bold text-zinc-400 tracking-wide">{group.label}</h3>
                    </div>
                    <motion.div
                      layout
                      className="p-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1"
                    >
                      {group.photos.map((p, i) => {
                        const isSelected = multiSelectedIds.includes(p.id);
                        return (
                          <motion.div
                            key={p.id}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.03 }}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className={`aspect-square relative group overflow-hidden cursor-pointer transition-all ${isSelected ? 'scale-90 rounded-xl' : 'rounded-sm'}`}
                            onClick={() => {
                              if (isSelectMode) {
                                setMultiSelectedIds(prev =>
                                  prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                                );
                              } else {
                                setSelectedPhoto(p);
                              }
                            }}
                          >
                            <img
                              src={p.imageUrl}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />

                            {isSelectMode && (
                              <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isSelected ? 'bg-blue-500 border-blue-500' : 'bg-black/20 border-white'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  </div>
                ))}
              </div>
            </div>

            {/* Floating Action Buttons for Share & Download */}
            <AnimatePresence>
              {multiSelectedIds.length > 0 && (
                <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
                  <motion.button
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={downloadSelectedPhotos}
                    title="تنزيل الصور المحددة"
                    className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-600/40 cursor-pointer"
                  >
                    <Download className="w-8 h-8 text-white" />
                  </motion.button>
                  <motion.button
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={sharePhotos}
                    title="مشاركة الصور المحددة"
                    className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center shadow-2xl shadow-green-600/40 cursor-pointer"
                  >
                    <Share2 className="w-8 h-8 text-white" />
                  </motion.button>
                </div>
              )}
            </AnimatePresence>

            {/* Full Screen Photo Viewer */}
            <AnimatePresence>
              {selectedPhoto && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col"
                >
                  <div className="p-6 flex justify-between items-center bg-zinc-900/40 backdrop-blur-xl border-b border-white/5">
                    <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSelectedPhoto(null)} className="p-2 bg-zinc-800 rounded-xl">
                      <X className="w-6 h-6" />
                    </motion.button>
                    <div className="text-center">
                      <p className="text-xs text-zinc-400 font-medium uppercase tracking-widest">{selectedPhoto.timestamp}</p>
                    </div>
                    <motion.button 
                      whileTap={{ scale: 0.9 }}
                      onClick={() => downloadPhoto(selectedPhoto.imageUrl)} 
                      className="p-2 bg-zinc-800 rounded-xl"
                    >
                      <Download className="w-6 h-6" />
                    </motion.button>
                  </div>
                  <div className="flex-1 flex items-center justify-center p-6 bg-gradient-to-b from-black/20 to-black/80">
                    <motion.img 
                      layoutId={`photo-${selectedPhoto.id}`}
                      src={selectedPhoto.imageUrl} 
                      className="max-w-full max-h-full rounded-3xl shadow-[0_30px_60px_rgba(0,0,0,0.8)] border border-white/10" 
                    />
                  </div>
                  <div className="p-8 bg-zinc-900/60 backdrop-blur-xl border-t border-white/5">
                    <div className="flex items-center gap-3 mb-6 bg-white/5 p-4 rounded-2xl border border-white/5">
                      <MapPin className="w-5 h-5 text-blue-400" />
                      <p className="text-xs opacity-80 leading-relaxed">{selectedPhoto.address}</p>
                    </div>
                    <div className="flex gap-4">
                      <motion.button 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                          if (navigator.share && navigator.canShare) {
                            try {
                              const response = await fetch(selectedPhoto.imageUrl);
                              const blob = await response.blob();
                              const file = new File([blob], `ReefSup_Photo_${new Date().getTime()}.jpg`, { type: 'image/jpeg' });
                              if (navigator.canShare({ files: [file] })) {
                                await navigator.share({
                                  files: [file],
                                  title: 'ReefSup Photo',
                                });
                                return;
                              }
                            } catch (err) {
                              console.error('File share failed:', err);
                            }
                          }

                          if (navigator.share) {
                            navigator.share({
                              title: 'ReefSup Photo',
                              url: window.location.href
                            });
                          } else {
                            navigator.clipboard.writeText(selectedPhoto.imageUrl);
                            setSuccessMessage('تم نسخ رابط الصورة');
                          }
                        }}
                        className="flex-1 bg-white text-black py-4 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-xl"
                      >
                        <Share2 className="w-5 h-5" />
                        مشاركة
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        </AnimatePresence>

        {/* Capture Preview Modal */}
        <AnimatePresence>
          {capturedImage && (view === 'camera' || view === 'upload') && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl flex flex-col"
            >
              <div className="p-6 flex justify-between items-center bg-zinc-900/50 backdrop-blur-xl border-b border-white/5">
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setCapturedImage(null)} className="p-2 bg-zinc-800 rounded-xl"><X className="w-6 h-6" /></motion.button>
                <span className="font-bold tracking-tight">معاينة الصورة</span>
                <div className="w-10" /> {/* Spacer */}
              </div>
              <div className="flex-1 min-h-0 relative flex items-center justify-center p-4 bg-gradient-to-b from-black/20 to-black/60 overflow-hidden">
                <motion.img 
                  initial={{ y: 20, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  src={capturedImage} 
                  className="max-w-full max-h-full object-contain rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10" 
                />

                {/* Vertical Action Rail on the Right */}
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-6 z-50">
                  {selectedFolder ? (
                    <>
                      <div className="flex flex-col items-center gap-2">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={saveToFirebase}
                          disabled={isSaving}
                          className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-600/40 disabled:opacity-50"
                        >
                          {isSaving ? <RefreshCw className="w-7 h-7 animate-spin text-white" /> : <Save className="w-7 h-7 text-white" />}
                        </motion.button>
                        <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">حفظ</span>
                      </div>
                      
                      <div className="flex flex-col items-center gap-2">
                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => setView('folders')}
                          className="w-16 h-16 bg-zinc-800/80 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 shadow-xl"
                        >
                          <FolderSync className="w-7 h-7 text-blue-400" />
                        </motion.button>
                        <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">نقل</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setView('folders')}
                        className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-600/40"
                      >
                        <FolderPlus className="w-7 h-7 text-white" />
                      </motion.button>
                      <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">اختيار</span>
                    </div>
                  )}

                  <div className="flex flex-col items-center gap-2">
                    <motion.button 
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => downloadPhoto()}
                      className="w-16 h-16 bg-zinc-800/80 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 shadow-xl"
                    >
                      <Download className="w-7 h-7 text-green-400" />
                    </motion.button>
                    <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">تنزيل</span>
                  </div>
                </div>
              </div>
              
              {/* Bottom Cancel Button (Subtle) */}
              <div className="p-4 bg-transparent flex justify-center shrink-0">
                <button 
                  onClick={() => setCapturedImage(null)} 
                  className="text-zinc-500 font-bold py-2 px-8 rounded-full border border-white/5 hover:bg-white/5 transition-colors"
                >
                  إلغاء المعاينة
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Edit Location Modal */}
        <AnimatePresence>
          {isEditingLocation && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto text-right"
              dir="rtl"
            >
              <motion.div
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                className="bg-zinc-900 w-full max-w-lg rounded-3xl p-5 sm:p-6 border border-white/10 shadow-2xl flex flex-col gap-4 text-white max-h-[92vh] overflow-y-auto"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-blue-400" />
                      تعديل الموقع والبحث الجغرافي
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">تعديل بيانات الختم الجغرافي للصور عبر الخريطة التفاعلية، البحث بالاسم، أو روابط خرائط جوجل.</p>
                  </div>
                  <button 
                    onClick={() => setIsEditingLocation(false)}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-750 rounded-full transition-colors text-zinc-400 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Section 1: Paste Google Maps Link / coordinates */}
                <div className="p-3 bg-zinc-850 rounded-2xl border border-white/5 flex flex-col gap-2">
                  <span className="text-xs font-bold text-zinc-400 block">رابط خرائط جوجل (Google Maps Link)</span>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="الصق رابط الموقع أو الإحداثيات هنا..."
                      value={googleMapsUrl}
                      onChange={e => setGoogleMapsUrl(e.target.value)}
                      className="flex-1 bg-zinc-800 border-none rounded-xl p-2.5 text-sm placeholder-zinc-600 text-white focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleImportGoogleMapsUrl}
                      className="bg-blue-600 hover:bg-blue-500 px-4 py-2.5 rounded-xl font-bold text-xs transition-colors shrink-0 cursor-pointer"
                    >
                      استيراد وتحليل
                    </button>
                  </div>
                </div>

                {/* Section 2: Search by Name */}
                <div className="flex flex-col gap-1 relative">
                  <label className="text-xs font-bold text-zinc-400">البحث عن موقع بالاسم</label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="مثال: برج خليفة، الرياض، كورنيش جدة..."
                      value={searchLocationQuery}
                      onChange={e => setSearchLocationQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSearchLocation()}
                      className="flex-1 bg-zinc-800 border-none rounded-xl p-3 text-sm placeholder-zinc-600 text-white focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSearchLocation}
                      disabled={isSearchingLoc}
                      className="bg-zinc-800 hover:bg-zinc-750 px-4 py-3 rounded-xl font-bold text-xs border border-white/5 transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isSearchingLoc ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-400" /> : null}
                      بحث
                    </button>
                  </div>

                  {/* Search results suggestion box */}
                  {searchLocationResults.length > 0 && (
                    <div className="absolute top-[100%] left-0 right-0 mt-1 bg-zinc-850 border border-white/10 rounded-2xl shadow-2xl max-h-48 overflow-y-auto z-50 p-1 flex flex-col gap-1">
                      {searchLocationResults.map((result, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSelectSearchResult(result)}
                          className="w-full text-right p-2.5 hover:bg-zinc-800 rounded-xl text-xs text-zinc-300 transition-colors flex flex-col gap-0.5 border-b border-white/5 last:border-none"
                        >
                          <span className="font-bold text-white">{result.address?.name || result.address?.city || result.address?.state || "موقع محدد"}</span>
                          <span className="text-[10px] text-zinc-500 truncate w-full">{result.display_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 3: Interactive Leaflet Map */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-zinc-400 flex items-center justify-between">
                    <span>الخريطة التفاعلية (اسحب الدبوس لتحديث الإحداثيات)</span>
                    <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">يمكنك النقر مباشرة على الخريطة</span>
                  </label>
                  <div className="h-[200px] w-full rounded-2xl border border-white/10 overflow-hidden relative z-0" id="edit-map-container" />
                </div>

                {/* Manual Editable Fields */}
                <div className="grid grid-cols-2 gap-3 bg-zinc-850/50 p-3 rounded-2xl border border-white/5">
                  {/* City Input */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-zinc-400">المدينة / المحافظة</label>
                    <input 
                      type="text"
                      placeholder="المدينة"
                      value={editCity}
                      onChange={e => setEditCity(e.target.value)}
                      className="w-full bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Detailed Address Input */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-zinc-400">العنوان أو الحي</label>
                    <input 
                      type="text"
                      placeholder="الحي أو الطريق"
                      value={editAddress}
                      onChange={e => setEditAddress(e.target.value)}
                      className="w-full bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Lat & Long row */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-zinc-400">خط العرض</label>
                    <input 
                      type="number"
                      step="any"
                      placeholder="24.7136"
                      value={editLatitude}
                      onChange={e => setEditLatitude(Number(e.target.value))}
                      className="w-full bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-zinc-400">خط الطول</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="46.6753"
                      value={editLongitude}
                      onChange={e => setEditLongitude(Number(e.target.value))}
                      className="w-full bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Date & Time Inputs */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-zinc-400">التاريخ (يظهر على الصورة)</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={e => setEditDate(e.target.value)}
                      className="w-full bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-zinc-400">الوقت</label>
                    <input
                      type="time"
                      value={editTime}
                      onChange={e => setEditTime(e.target.value)}
                      className="w-full bg-zinc-800 border-none rounded-xl p-2.5 text-xs text-white placeholder-zinc-600 focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
                    />
                  </div>
                </div>

                {/* GPS trigger inside the modal */}
                <button
                  type="button"
                  onClick={updateLocation}
                  disabled={isLocating}
                  className="w-full bg-zinc-800 hover:bg-zinc-750 text-zinc-300 py-3 rounded-xl font-bold flex items-center justify-center gap-2 text-xs transition-colors border border-white/5 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 text-blue-400 ${isLocating ? 'animate-spin' : ''}`} />
                  تحديد الموقع الحالي عبر GPS الجهاز تلقائياً
                </button>

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  <button 
                    onClick={() => setIsEditingLocation(false)} 
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-750 rounded-xl text-zinc-400 font-bold text-sm transition-colors cursor-pointer border border-white/5"
                  >
                    إلغاء
                  </button>
                  <button 
                    onClick={handleSaveLocation} 
                    className="flex-1 bg-blue-600 hover:bg-blue-500 rounded-xl py-3 font-bold text-sm text-white shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all cursor-pointer"
                  >
                    تطبيق وحفظ التعديلات
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Create Folder Modal */}
        <AnimatePresence>
          {isCreatingFolder && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 text-right"
              dir="rtl"
            >
              <motion.div
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                className="bg-zinc-900 w-full max-w-md rounded-3xl p-6 border border-white/10 shadow-2xl flex flex-col gap-4 text-white"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Search className="w-5 h-5 text-blue-400" />
                      البحث عن مشروع
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">ابحث عن مشروع موجود لاختياره، أو اكتب اسمًا جديدًا لإنشائه.</p>
                  </div>
                  <button
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName('');
                    }}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-750 rounded-full transition-colors text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-xs font-bold text-zinc-400">اسم المشروع</label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-zinc-600 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="ابحث عن مشروع أو اكتب اسمًا جديدًا..."
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleFolderSearchEnter()}
                      className="w-full bg-zinc-800 border-none rounded-2xl p-4 pr-11 text-sm placeholder-zinc-600 text-white focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                  {folders
                    .filter(f => f.name.toLowerCase().includes(newFolderName.trim().toLowerCase()))
                    .map(f => (
                      <button
                        key={f.id}
                        onClick={() => selectExistingFolder(f)}
                        className="flex items-center gap-3 p-3 bg-zinc-800/60 hover:bg-zinc-800 rounded-2xl text-right transition-colors cursor-pointer"
                      >
                        <div className="p-2 rounded-xl bg-zinc-700/50 text-blue-400 shrink-0">
                          <Folder className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-bold truncate flex-1">{f.name}</span>
                      </button>
                    ))}

                  {newFolderName.trim() && !folders.some(f => f.name.trim().toLowerCase() === newFolderName.trim().toLowerCase()) && (
                    <button
                      onClick={createFolder}
                      className="flex items-center gap-3 p-3 bg-blue-600/10 hover:bg-blue-600/20 border border-dashed border-blue-500/40 rounded-2xl text-right transition-colors cursor-pointer"
                    >
                      <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 shrink-0">
                        <FolderPlus className="w-4 h-4" />
                      </div>
                      <span className="text-sm font-bold text-blue-400 truncate flex-1">إنشاء مشروع جديد باسم "{newFolderName.trim()}"</span>
                    </button>
                  )}

                  {!newFolderName.trim() && folders.length === 0 && (
                    <p className="text-xs text-zinc-600 text-center py-6">لا توجد مشاريع بعد. اكتب اسمًا لإنشاء أول مشروع.</p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName('');
                    }}
                    className="flex-1 py-3.5 bg-zinc-800 hover:bg-zinc-750 rounded-xl text-zinc-400 font-bold text-sm transition-colors cursor-pointer border border-white/5"
                  >
                    إلغاء
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rename Folder Modal */}
        <AnimatePresence>
          {isRenamingFolder && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 text-right"
              dir="rtl"
            >
              <motion.div
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                className="bg-zinc-900 w-full max-w-md rounded-3xl p-6 border border-white/10 shadow-2xl flex flex-col gap-4 text-white"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <Folder className="w-5 h-5 text-blue-400" />
                      تعديل اسم المجلد
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">قم بتعديل الاسم الحالي للمجلد.</p>
                  </div>
                  <button 
                    onClick={() => {
                      setIsRenamingFolder(false);
                      setRenamingFolder(null);
                      setRenameFolderName('');
                    }}
                    className="p-1.5 bg-zinc-800 hover:bg-zinc-750 rounded-full transition-colors text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-xs font-bold text-zinc-400">الاسم الجديد</label>
                  <input 
                    type="text"
                    placeholder="أدخل الاسم الجديد للمجلد..."
                    value={renameFolderName}
                    onChange={e => setRenameFolderName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && renameFolder()}
                    className="w-full bg-zinc-800 border-none rounded-2xl p-4 text-sm placeholder-zinc-600 text-white focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => {
                      setIsRenamingFolder(false);
                      setRenamingFolder(null);
                      setRenameFolderName('');
                    }} 
                    className="flex-1 py-3.5 bg-zinc-800 hover:bg-zinc-750 rounded-xl text-zinc-400 font-bold text-sm transition-colors cursor-pointer border border-white/5"
                  >
                    إلغاء
                  </button>
                  <button 
                    onClick={renameFolder} 
                    disabled={!renameFolderName.trim() || renameFolderName.trim() === renamingFolder?.name}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 rounded-xl py-3.5 font-bold text-sm text-white shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
                  >
                    تطبيق التعديل
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-6 right-6 bg-red-500 text-white p-4 rounded-2xl flex items-center gap-3 z-[70]"
          >
            <Info className="w-5 h-5 shrink-0" />
            <p className="text-sm flex-1">{error}</p>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
